"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Detection = { class: string; score: number; bbox: [number, number, number, number] };
type Detector = { detect: (video: HTMLVideoElement, maxBoxes?: number, minScore?: number) => Promise<Detection[]> };
type Track = { id: number; x: number; y: number; side: number; candidate: number; frames: number; lastSeen: number; lastCount: number };
type Crossing = { id: number; type: "entry" | "exit"; time: string };
type Config = { axis: "vertical" | "horizontal"; direction: 1 | -1; position: number };

declare global { interface Window { tf?: unknown; cocoSsd?: { load: (options: { base: string }) => Promise<Detector> } } }

const tfUrl = "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js";
const modelUrl = "https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js";

function script(src: string) {
  return new Promise<void>((resolve, reject) => {
    const found = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (found?.dataset.ready === "true") return resolve();
    const tag = found ?? document.createElement("script");
    tag.src = src;
    tag.addEventListener("load", () => { tag.dataset.ready = "true"; resolve(); }, { once: true });
    tag.addEventListener("error", () => { tag.remove(); reject(new Error("Could not load person detection. Check your internet connection.")); }, { once: true });
    if (!found) document.head.appendChild(tag);
  });
}

async function getDetector() {
  if (!window.tf) await script(tfUrl);
  if (!window.cocoSsd) await script(modelUrl);
  if (!window.cocoSsd) throw new Error("Person detection did not initialize.");
  return window.cocoSsd.load({ base: "lite_mobilenet_v2" });
}

function side(x: number, y: number, width: number, height: number, config: Config) {
  const size = config.axis === "vertical" ? width : height;
  const point = config.axis === "vertical" ? x : y;
  const delta = point - size * config.position / 100;
  return Math.abs(delta) < size * 0.035 ? 0 : delta > 0 ? 1 : -1;
}

export default function Home() {
  const [state, setState] = useState<"idle" | "loading" | "live" | "error">("idle");
  const [error, setError] = useState("");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [config, setConfig] = useState<Config>({ axis: "vertical", direction: 1, position: 50 });
  const [starting, setStarting] = useState(0);
  const [entries, setEntries] = useState(0);
  const [exits, setExits] = useState(0);
  const [visible, setVisible] = useState(0);
  const [history, setHistory] = useState<Crossing[]>([]);
  const [ratio, setRatio] = useState("16 / 9");
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const detector = useRef<Detector | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const run = useRef(0);
  const tracks = useRef<Track[]>([]);
  const nextId = useRef(1);
  const liveConfig = useRef(config);
  useEffect(() => { liveConfig.current = config; }, [config]);
  useEffect(() => { navigator.mediaDevices?.enumerateDevices().then(list => setDevices(list.filter(item => item.kind === "videoinput"))).catch(() => {}); }, []);

  const stop = useCallback(() => {
    run.current++;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    const overlay = canvas.current;
    overlay?.getContext("2d")?.clearRect(0, 0, overlay.width, overlay.height);
    tracks.current = [];
    setVisible(0);
  }, []);
  useEffect(() => () => stop(), [stop]);

  const draw = useCallback((people: Detection[], width: number, height: number) => {
    const element = canvas.current;
    if (!element) return;
    element.width = width;
    element.height = height;
    const context = element.getContext("2d");
    if (!context) return;
    const setting = liveConfig.current;
    const line = (setting.axis === "vertical" ? width : height) * setting.position / 100;
    context.strokeStyle = "#b9f47b";
    context.lineWidth = Math.max(3, width / 350);
    context.setLineDash([14, 10]);
    context.beginPath();
    if (setting.axis === "vertical") { context.moveTo(line, 0); context.lineTo(line, height); }
    else { context.moveTo(0, line); context.lineTo(width, line); }
    context.stroke();
    context.setLineDash([]);
    context.font = `700 ${Math.max(14, width / 60)}px Arial`;
    const label = "COUNTING LINE";
    const labelWidth = context.measureText(label).width + 18;
    const lx = setting.axis === "vertical" ? Math.min(line + 10, width - labelWidth - 8) : 12;
    const ly = setting.axis === "vertical" ? 28 : Math.max(28, line - 10);
    context.fillStyle = "#b9f47b";
    context.fillRect(lx, ly - 20, labelWidth, 27);
    context.fillStyle = "#172419";
    context.fillText(label, lx + 9, ly);
    for (const person of people) {
      const [x, y, w, h] = person.bbox;
      context.strokeStyle = "#83d9f0";
      context.lineWidth = Math.max(2, width / 450);
      context.strokeRect(x, y, w, h);
      const caption = `PERSON ${Math.round(person.score * 100)}%`;
      const captionWidth = context.measureText(caption).width + 16;
      context.fillStyle = "#83d9f0";
      context.fillRect(x, Math.max(0, y - 27), captionWidth, 27);
      context.fillStyle = "#102329";
      context.fillText(caption, x + 8, Math.max(20, y - 7));
    }
  }, []);

  const count = useCallback((people: Detection[], width: number, height: number) => {
    const now = Date.now();
    const active = tracks.current.filter(track => now - track.lastSeen < 1200);
    const used = new Set<number>();
    for (const person of people) {
      const [bx, by, bw, bh] = person.bbox;
      const x = bx + bw / 2, y = by + bh / 2;
      let match: Track | undefined, closest = Infinity;
      for (const track of active) {
        if (used.has(track.id)) continue;
        const distance = Math.hypot((x - track.x) / width, (y - track.y) / height);
        if (distance < .18 && distance < closest) { match = track; closest = distance; }
      }
      const currentSide = side(x, y, width, height, liveConfig.current);
      if (!match) {
        match = { id: nextId.current++, x, y, side: currentSide, candidate: 0, frames: 0, lastSeen: now, lastCount: 0 };
        active.push(match);
      } else {
        if (currentSide && currentSide !== match.side) {
          match.frames = match.candidate === currentSide ? match.frames + 1 : 1;
          match.candidate = currentSide;
          if (match.frames >= 2) {
            if (match.side && now - match.lastCount > 1800) {
              const type: Crossing["type"] = currentSide === liveConfig.current.direction ? "entry" : "exit";
              if (type === "entry") setEntries(value => value + 1);
              else setExits(value => value + 1);
              setHistory(items => [{ id: now + match!.id, type, time: new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) }, ...items].slice(0, 8));
              match.lastCount = now;
            }
            match.side = currentSide;
            match.frames = 0;
          }
        } else if (currentSide === match.side) { match.candidate = 0; match.frames = 0; }
        match.x = x; match.y = y; match.lastSeen = now;
      }
      used.add(match.id);
    }
    tracks.current = active;
    setVisible(people.length);
  }, []);

  const start = useCallback(async (selected = "") => {
    stop();
    const token = run.current;
    setError(""); setState("loading");
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera access requires HTTPS or localhost in a supported browser.");
      const feed = await navigator.mediaDevices.getUserMedia({ audio: false, video: { deviceId: selected ? { exact: selected } : undefined, facingMode: selected ? undefined : { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } });
      if (token !== run.current) { feed.getTracks().forEach(track => track.stop()); return; }
      stream.current = feed;
      if (!video.current) throw new Error("Camera preview is unavailable.");
      video.current.srcObject = feed;
      await video.current.play();
      setRatio(`${video.current.videoWidth || 16} / ${video.current.videoHeight || 9}`);
      navigator.mediaDevices.enumerateDevices().then(list => setDevices(list.filter(item => item.kind === "videoinput"))).catch(() => {});
      if (!detector.current) detector.current = await getDetector();
      if (token !== run.current) return;
      setState("live");
      const scan = async () => {
        if (token !== run.current || !video.current || !detector.current) return;
        try {
          const frame = video.current;
          if (frame.readyState >= 2) {
            const people = (await detector.current.detect(frame, 20, .45)).filter(item => item.class === "person" && item.score >= .55);
            if (token !== run.current) return;
            count(people, frame.videoWidth, frame.videoHeight);
            draw(people, frame.videoWidth, frame.videoHeight);
          }
          timer.current = setTimeout(scan, 180);
        } catch { stop(); setError("Detection paused. Restart the camera to try again."); setState("error"); }
      };
      scan();
    } catch (cause) {
      if (token !== run.current) return;
      stop(); setState("error");
      const detail = cause instanceof Error ? cause.message : "Camera could not start.";
      setError(/denied|permission/i.test(detail) ? "Camera permission was denied. Allow access in your browser and try again." : detail);
    }
  }, [count, draw, stop]);

  const update = (changes: Partial<Config>) => {
    liveConfig.current = { ...liveConfig.current, ...changes };
    setConfig(liveConfig.current);
    tracks.current = [];
    if (state === "live" && video.current) draw([], video.current.videoWidth, video.current.videoHeight);
  };
  const occupancy = Math.max(0, starting + entries - exits);

  return <main className="shell">
    <header className="topbar"><div className="brand"><span className="brand-icon"><i /><i /><i /></span><span><strong>ROOMPULSE</strong><small>LIVE OCCUPANCY</small></span></div><div className="header-right"><span className="device-badge"><i /> ON-DEVICE DASHBOARD</span><span className="date">{new Date().toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</span></div></header>
    <section className="intro"><div><div className="eyebrow"><i /> SMART SPACE MONITORING</div><h1>Every crossing.<br /><em>One clear count.</em></h1><p>See who enters and leaves through your doorway camera, with a live estimate of how many people are inside.</p></div><div className="intro-tip"><span>↗</span>Set the line across your doorway and point the entry direction into the room.</div></section>
    <section className="stats" aria-label="Occupancy dashboard"><article className="stat primary"><div className="stat-top">PEOPLE INSIDE <span>◎</span></div><strong>{String(occupancy).padStart(2, "0")}</strong><small>● &nbsp; Current occupancy</small></article><article className="stat"><div className="stat-top">TOTAL ENTRIES <span className="green">↗</span></div><strong>{String(entries).padStart(2, "0")}</strong><small>Crossed into the room</small></article><article className="stat"><div className="stat-top">TOTAL EXITS <span className="orange">↘</span></div><strong>{String(exits).padStart(2, "0")}</strong><small>Crossed out of the room</small></article><article className="stat"><div className="stat-top">IN FRAME NOW <span className="blue">◉</span></div><strong>{String(visible).padStart(2, "0")}</strong><small>People visible to camera</small></article></section>
    <section className="workspace"><div className="panel feed"><div className="panel-heading"><div><small>01 / LIVE VIEW</small><h2>Doorway camera</h2></div><span className={`live-badge ${state === "live" ? "on" : ""}`}><i /> {state === "live" ? "LIVE" : state === "loading" ? "STARTING" : "OFFLINE"}</span></div><div className="video-area" style={{ aspectRatio: ratio }}><video ref={video} autoPlay muted playsInline aria-label="Live doorway camera" /><canvas ref={canvas} aria-hidden="true" />{state !== "live" && <div className="video-placeholder"><span className="camera-icon"><i /></span><strong>{state === "loading" ? "Preparing your live view" : "Your doorway, in focus"}</strong><p>{state === "loading" ? "Loading camera and person detection…" : "Start your camera to detect and count crossings."}</p><button className="start-button" disabled={state === "loading"} onClick={() => start(deviceId)}>{state === "loading" ? "Starting…" : "Start live camera"}<span>↗</span></button></div>}</div><div className="feed-bottom"><div className="legend"><span><i className="box-key" /> Person detected</span><span><i className="line-key" /> Counting line</span></div>{state === "live" && <button className="stop-button" onClick={() => { stop(); setState("idle"); }}>Stop camera ×</button>}</div>{error && <p className="error" role="alert">{error}</p>}</div>
      <aside className="sidebar"><section className="panel setup"><div className="panel-heading"><div><small>02 / SETUP</small><h2>Counting settings</h2></div><span className="heading-icon">☷</span></div><div className="form"><label htmlFor="camera">CAMERA SOURCE</label><select id="camera" value={deviceId} onChange={event => { setDeviceId(event.target.value); if (state === "live") start(event.target.value); }}><option value="">{devices.length ? "Default camera" : "Camera appears after access"}</option>{devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Camera ${index + 1}`}</option>)}</select><div className="form-grid"><div><label htmlFor="axis">LINE DIRECTION</label><select id="axis" value={config.axis} onChange={event => update({ axis: event.target.value as Config["axis"] })}><option value="vertical">Vertical</option><option value="horizontal">Horizontal</option></select></div><div><label htmlFor="direction">ENTRY GOES</label><select id="direction" value={config.direction} onChange={event => update({ direction: Number(event.target.value) as 1 | -1 })}>{config.axis === "vertical" ? <><option value={1}>Left → right</option><option value={-1}>Right → left</option></> : <><option value={1}>Top → bottom</option><option value={-1}>Bottom → top</option></>}</select></div></div><div className="range-label"><label htmlFor="position">LINE POSITION</label><span>{config.position}%</span></div><input id="position" className="range" type="range" min="15" max="85" value={config.position} onChange={event => update({ position: Number(event.target.value) })} /><hr /><div className="starting"><div><label htmlFor="starting">STARTING OCCUPANCY</label><p>People already inside when you begin.</p></div><input id="starting" type="number" min="0" max="9999" value={starting} onChange={event => setStarting(Math.max(0, Number(event.target.value) || 0))} /></div><button className="reset" onClick={() => { setEntries(0); setExits(0); setHistory([]); tracks.current = []; }}>↺ &nbsp; Reset entry and exit totals</button></div></section><section className="panel activity"><div className="panel-heading"><div><small>03 / ACTIVITY</small><h2>Recent crossings</h2></div><span className="event-count">{String(history.length).padStart(2, "0")}</span></div>{history.length ? <ul>{history.map(event => <li key={event.id}><span className={`event-icon ${event.type}`}>{event.type === "entry" ? "↗" : "↘"}</span><span><strong>Person {event.type === "entry" ? "entered" : "exited"}</strong><small>{event.type === "entry" ? "Into the room" : "Out of the room"}</small></span><time>{event.time}</time></li>)}</ul> : <div className="empty"><span>◎</span><p>Crossings will appear here as people pass the line.</p></div>}</section></aside></section>
    <footer><span>ROOMPULSE <b>·</b> LIVE ROOM COUNTING</span><span>Counts are estimates. Keep the full doorway visible for best results.</span></footer>
  </main>;
}
