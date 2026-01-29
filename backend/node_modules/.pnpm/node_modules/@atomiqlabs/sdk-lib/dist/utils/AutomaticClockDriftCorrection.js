"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.correctClock = void 0;
const Utils_1 = require("./Utils");
const headerUrls = ["https://api.atomiq.exchange/"];
async function getHeaderTimestamp(url) {
    const timeStart = performance.now();
    const resp = await fetch(url, { method: "HEAD", signal: (0, Utils_1.timeoutSignal)(3000) });
    const timeDelta = performance.now() - timeStart;
    const dateHeaderValue = resp.headers.get("Date");
    if (dateHeaderValue == null)
        throw new Error("Date header not returned!");
    return { delta: timeDelta, timestamp: new Date(dateHeaderValue).getTime() };
}
async function getBinanceTimestamp() {
    const timeStart = performance.now();
    const resp = await fetch("https://api.binance.com/api/v3/time", { signal: (0, Utils_1.timeoutSignal)(3000) });
    const timeDelta = performance.now() - timeStart;
    const obj = await resp.json();
    if (obj == null || obj.serverTime == null)
        throw new Error("Timestamp not returned!");
    return { delta: timeDelta, timestamp: Math.floor(obj.serverTime) };
}
async function getOKXTimestamp() {
    const timeStart = performance.now();
    const resp = await fetch("https://www.okx.com/api/v5/public/time", { signal: (0, Utils_1.timeoutSignal)(3000) });
    const timeDelta = performance.now() - timeStart;
    const obj = await resp.json();
    if (obj == null || obj.data == null || obj.data[0] == null || obj.data[0].ts == null)
        throw new Error("Timestamp not returned!");
    return { delta: timeDelta, timestamp: Math.floor(obj.data[0].ts) };
}
async function getAisenseApiTimestamp() {
    const timeStart = performance.now();
    const resp = await fetch("https://aisenseapi.com/services/v1/timestamp", { signal: (0, Utils_1.timeoutSignal)(3000) });
    const timeDelta = performance.now() - timeStart;
    const obj = await resp.json();
    if (obj == null || obj.timestamp == null)
        throw new Error("Timestamp not returned!");
    return { delta: timeDelta, timestamp: Math.floor(obj.timestamp * 1000) };
}
async function correctClock() {
    const dateNow = Date._now ?? Date.now;
    const dateStart = performance.now();
    try {
        let result = await Promise.any([
            ...headerUrls.map(url => getHeaderTimestamp(url)),
            getAisenseApiTimestamp(),
            getBinanceTimestamp(),
            getOKXTimestamp()
        ]);
        const desiredTime = result.timestamp - (result.delta / 2);
        if (Math.abs(Date.now() - desiredTime) < 2000) {
            console.log("AutomaticClockDriftCorrection: correctClock(): Time drift too small, not adjusting!");
            return;
        }
        const timeDrift = dateStart - desiredTime;
        console.log(`AutomaticClockDriftCorrection: correctClock(): Time correction perf.now: ${dateStart}, server: ${desiredTime}, time diff: ${timeDrift}`);
        Date._now = dateNow;
        Date.now = () => {
            return Math.floor(performance.now() - timeDrift);
        };
    }
    catch (e) {
        if (e instanceof AggregateError)
            e.message = "Cannot sync time! All servers responded negatively!";
        throw e;
    }
}
exports.correctClock = correctClock;
