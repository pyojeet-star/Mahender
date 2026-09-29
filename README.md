# RoomPulse

A live doorway counting dashboard. It uses the browser camera and TensorFlow.js COCO-SSD to detect people, draws detection boxes, and counts tracked people when they cross a configurable line. Occupancy is calculated as starting occupancy + entries - exits, with a floor of zero.

## Run locally

```bash
npm ci
npm run dev
```


Open the local URL shown by the server, allow camera access, position the camera to show the entire doorway, and select the correct entry direction. Camera access requires localhost or HTTPS. The detection scripts and model load from the internet when the camera starts. Video stays in the browser; no footage or counts are uploaded by the app.

## Limits

Counts are estimates. Occlusion, poor lighting, fast movement, or people crossing side by side can cause missed or duplicate counts. Set starting occupancy to the number already inside before monitoring. Totals last for the current page session and can be reset in the dashboard.
