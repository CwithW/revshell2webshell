import express, { Request, Response } from 'express';
import WebSocket from 'ws';

const app = express();
app.use(express.urlencoded({ limit: "50mb", extended: false }))
const port = 3000;

//CHANGEME
const SHELLBIN_ADDR = "http://shellbin.changeme.com"

function get_ws_host(): string {
    if (SHELLBIN_ADDR.startsWith("http://")) {
        return SHELLBIN_ADDR.replace("http://", "ws://")
    } else if (SHELLBIN_ADDR.startsWith("https://")) {
        return SHELLBIN_ADDR.replace("https://", "wss://")
    } else {
        return SHELLBIN_ADDR
    }
}


function log(...args: any[]) {
    if (!process.env.DEBUG) return;
    console.log(...args);
}




app.get('/', (req: Request, res: Response) => {
    res.send('Hello World!');
});

app.post("/shell/:os_type/:shell_uuid", async (req: Request, res: Response) => {
    const osType = req.params.os_type;
    const shellUuid = req.params.shell_uuid;
    const command = req.body['1'] || req.body['command'];


    // Handle the shell command execution here
    log(`Executing shell command on ${osType} with UUID ${shellUuid}`);
    log(command);

    let firstTimeout = 10000;
    let afterDataTimeout = 500;
    let endNeedle: null | Buffer = null;

    if (osType === "windows" || osType === "win") {
        afterDataTimeout = 5000;
        // parse windows command, find end needle
        // powershell -nop -enc <base64_command>
        const regex_for_enc = /-enc\s+([A-Za-z0-9+/=]+)/i;
        const match = command.match(regex_for_enc);
        if (match) {
            const base64Command = match[1];
            const decodedCommand = Buffer.from(base64Command, 'base64').toString('utf16le');
            log(`Decoded PowerShell command: ${decodedCommand}`);
            // $TAGE=[System.String]::Concat('9b91','a35a4');
            const regex_for_endNeedle = /\$TAGE=\[System.String\]::Concat\('([A-Za-z0-9]+)','([A-Za-z0-9]+)'\);/i;
            const endNeedleMatch = decodedCommand.match(regex_for_endNeedle);
            if (endNeedleMatch) {
                endNeedle = Buffer.from(endNeedleMatch[1] + endNeedleMatch[2], 'utf8');
                log(`Extracted endNeedle: ${endNeedle}`);
            }
        }
    }else if (osType === "linux") {
        afterDataTimeout = 5000;
        // TAGE="e389a2""1f7653";
        const regex_for_endNeedle = /TAGE="([a-fA-F0-9]+)""([a-fA-F0-9]+)";/i;
        const endNeedleMatch = command.match(regex_for_endNeedle);
        if (endNeedleMatch) {
            endNeedle = Buffer.from(endNeedleMatch[1] + endNeedleMatch[2], 'utf8');
            log(`Extracted endNeedle: ${endNeedle}`);
        }
    }

    const wsPath = get_ws_host() + "/api/client/" + shellUuid + "?nohistory=1";
    const result = await new Promise((resolve, reject) => {
        const ws = new WebSocket(wsPath);
        let buffer = Buffer.alloc(0);
        function end() {
            ws.close();
            if (buffer.length > 0) {
                resolve(buffer);
            } else {
                reject(new Error("No data received"));
            }
        }
        let timeout = setTimeout(end, firstTimeout);
        ws.on('open', () => {
            log('WebSocket connection opened');
            ws.send(command + "\n");
        });

        ws.on('message', (message) => {
            log(`Received message: ${message}`);
            const messageBuffer = message as Buffer;
            buffer = Buffer.concat([buffer, messageBuffer]);
            if (endNeedle != null) {
                if (buffer.includes(endNeedle)) {
                    log('End needle detected, ending data collection');
                    clearTimeout(timeout);
                    end();
                }
            } else {
                clearTimeout(timeout);
                timeout = setTimeout(end, afterDataTimeout);
            }
        });

        ws.on('error', (error) => {
            log(`WebSocket error: ${error}`);
            reject(error);
        });
    }) as Buffer;

    res.end(result);

});

app.listen(port, "0.0.0.0", () => {
    console.log(`Example app listening on port ${port}`);
});

