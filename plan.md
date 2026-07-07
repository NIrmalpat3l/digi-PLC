# Remote HMI for PLC — Implementation Plan
## (Modbus RTU over RS485/USB → Web-based HMI on any PC in the network)

## 1. Goal
Operate a machine's PLC (currently controlled locally via a physical HMI screen) from
any laptop/PC on the local network, so the operator does not need to stand in the hot
machine room. The remote screen should mirror the same controls: Cycle Start/Stop,
Output 1–4 on/off, On-time and Delay-time settings, and live "Running" feedback values.

## 2. Current Setup
- PLC connected to a PC via an RS485-to-USB adapter (Modbus RTU, serial).
- Known register map (see Section 6).
- Local HMI screen currently does this job directly, wired to the PLC.

## 3. Architecture (3-tier)

```
 ┌─────────────┐   RS485/USB    ┌───────────────────────┐   LAN (HTTP/WebSocket)  ┌─────────────────┐
 │     PLC     │◄──────────────►│  Gateway/Bridge Service │◄───────────────────────►│  Web HMI (browser) │
 │ (Modbus RTU │   Modbus RTU   │  (runs on the PC that's │      REST + WS/MQTT     │  on any PC/laptop  │
 │   slave)    │                │  physically wired to    │                          │  on the same LAN   │
 └─────────────┘                │  the PLC via USB)       │                          └─────────────────┘
                                 └───────────────────────┘
```

Key idea: **one PC stays physically connected** to the PLC via the RS485/USB cable and
runs a small "Gateway" service. That service is the *only* thing that talks Modbus RTU.
Every other PC/laptop just opens a **web browser** pointed at that PC's IP address —
no drivers, no PLC software, no cables needed on the client machines.

This also means you can later add authentication, logging, multiple machines, or a
cloud layer without touching the PLC wiring at all.

## 4. Components

### 4.1 Gateway / Bridge Service (the core piece)
- Runs on the PC physically wired to the PLC (RS485-USB).
- Responsibilities:
  - Poll Input Registers + Coils on a fixed interval (e.g. every 250–500ms) and cache
    the latest values in memory.
  - Push updates to connected browsers in real time via **WebSocket**.
  - Accept write commands from the browser (start/stop, toggle outputs, change SET
    values) and translate them into the correct Modbus function codes.
  - Handle **momentary bit logic** for Cycle Start/Cycle Stop: write coil = 1, wait
    ~200–500ms, write coil = 0 automatically. The browser should never be responsible
    for resetting these.
  - Maintain a serial connection watchdog: detect if the USB/RS485 link drops and
    surface a clear "PLC disconnected" status to all clients instead of silently
    failing.
  - Queue/serialize writes so two operators clicking buttons at once don't corrupt the
    Modbus transaction (Modbus RTU is single-threaded/half-duplex).

- Suggested stack: **Node.js + `modbus-serial`** or **Python + `pymodbus`**, either is
  fine. Node.js pairs naturally with a WebSocket server (`ws` or `socket.io`) and a
  React frontend if you want one language end-to-end. Python is fine too if the team
  is more comfortable there (`pymodbus` + `FastAPI` + `websockets`).

### 4.2 Register Map Config
Externalize the register map as a config/JSON file (not hardcoded), so it's easy to
extend for more machines or points later. See Section 6 for the actual mapping to use.

### 4.3 API / WebSocket Layer
- `GET /api/status` — snapshot of all current values + PLC connection status.
- `POST /api/write` — body: `{ point: "output1", value: true }` → gateway maps this to
  the correct coil/register + function code.
- `WS /ws/live` — streams live value updates (Running values, output states) to all
  connected browsers so multiple people can watch the same machine simultaneously.

### 4.4 Web HMI Frontend
- A browser-based UI (React or plain HTML/JS is fine — doesn't need to be fancy)
  laid out like the existing physical HMI:
  - Cycle Start / Cycle Stop buttons (momentary — call the API, don't hold state).
  - Output 1–4 toggle switches with live on/off indicator (from Input Register /
    Coil feedback, not just optimistic UI).
  - On-time (SET) and Delay Time (SET) numeric inputs with a "Write" / "Apply" button
    — don't write on every keystroke.
  - On-time (Running) and Delay Time (Running) shown as read-only live values.
  - Clear "PLC Connected / Disconnected" banner.
  - Optional: simple login (see Section 9) before controls are enabled.

### 4.5 Network
- Gateway PC needs a static/reserved LAN IP (or a fixed hostname via the router) so
  browsers always know where to connect.
- Everything stays inside the local network initially — no internet exposure needed
  unless the client explicitly wants remote-outside-the-building access later (that's
  a separate, higher-security phase — VPN, not raw port-forwarding).

## 5. Data Flow (typical operator action)
1. Operator opens `http://<gateway-pc-ip>:PORT` in a browser on any PC.
2. Browser opens a WebSocket, gateway starts streaming live values (outputs, running
   times, connection status).
3. Operator clicks "Cycle Start" → browser POSTs to `/api/write` → gateway writes coil
   513 = 1 → waits briefly → writes coil 513 = 0 (momentary pulse) → PLC starts cycle.
4. Gateway's polling loop reads the Input Registers (Running values) and Coils
   (Output states) continuously and pushes them out over WebSocket → browser updates
   live, no manual refresh.

## 6. Register Map (from your table)

| Description | Modbus Address | Register Type | Function Code(s) |
|---|---|---|---|
| Cycle Start (Momentary Bit) | 513 | Coil | Read: FC01, Write: FC05 |
| Cycle Stop (Momentary Bit) | 515 | Coil | Read: FC01, Write: FC05 |
| Output-1 | 1 | Coil | Read: FC01, Write: FC05 |
| Output-2 | 2 | Coil | Read: FC01, Write: FC05 |
| Output-3 | 3 | Coil | Read: FC01, Write: FC05 |
| Output-4 | 4 | Coil | Read: FC01, Write: FC05 |
| Output-1 On time (SET) | 1537 | Holding Register (32-bit unsigned) | Read: FC03, Write: FC16 |
| Output-2 On time (SET) | 1541 | Holding Register (32-bit unsigned) | Read: FC03, Write: FC16 |
| Output-3 On time (SET) | 1545 | Holding Register (32-bit unsigned) | Read: FC03, Write: FC16 |
| Output-4 On time (SET) | 1549 | Holding Register (32-bit unsigned) | Read: FC03, Write: FC16 |
| Delay Time (SET) | 1539 | Holding Register (32-bit unsigned) | Read: FC03, Write: FC16 |
| Output-1 On time (Running) | 1537 | Input Register (32-bit unsigned) | Read: FC04 (read-only) |
| Output-2 On time (Running) | 1541 | Input Register (32-bit unsigned) | Read: FC04 (read-only) |
| Output-3 On time (Running) | 1545 | Input Register (32-bit unsigned) | Read: FC04 (read-only) |
| Output-4 On time (Running) | 1549 | Input Register (32-bit unsigned) | Read: FC04 (read-only) |
| Delay Time (Running) | 1539 | Input Register (32-bit unsigned) | Read: FC04 (read-only) |

**Notes for the coding agent:**
- 32-bit values span 2 consecutive 16-bit Modbus registers — confirm the word order
  (big-endian/little-endian, and register-order high-first or low-first) against the
  actual PLC vendor's documentation before trusting values. This varies by PLC brand
  and is the #1 source of "the number looks wrong by a weird multiple" bugs.
- The exact serial parameters (baud rate, parity, stop bits, slave/unit ID) aren't in
  the table — get these from the PLC programming software or the person who set up
  the RS485/USB link, and confirm them with a quick read-test before building the UI.

## 7. Suggested Tech Stack
- **Gateway service:** Node.js + `modbus-serial` + `ws` (or Python + `pymodbus` +
  `FastAPI`/`websockets`) — whichever the dev team is more comfortable with.
- **Frontend:** React (or plain HTML/JS) served by the same gateway process to keep
  deployment to a single running service.
- **Process management:** run the gateway as a Windows Service (e.g. via `nssm`) or a
  systemd service if on Linux, so it survives PC reboots without manual restart.

## 8. Phased Implementation Plan
1. **Phase 1 — Confirm serial link:** Write a small standalone script that connects
   to the PLC over the RS485/USB adapter and successfully reads one known coil and one
   known register. Confirm baud/parity/unit ID and 32-bit word order here first.
2. **Phase 2 — Gateway core:** Build the polling loop + in-memory cache + write queue
   for all points in Section 6.
3. **Phase 3 — API/WebSocket layer:** Expose status + write endpoints, add the
   momentary-pulse logic for Cycle Start/Stop.
4. **Phase 4 — Frontend HMI:** Build the browser UI mirroring the physical HMI layout,
   wired to the API/WebSocket.
5. **Phase 5 — Reliability:** Add reconnect logic, "PLC disconnected" UI state, write
   confirmation/error handling, and basic logging of every write command (who, what,
   when) for traceability.
6. **Phase 6 — Access control:** Add a simple login so only authorized operators can
   send write commands (see Section 9).
7. **Phase 7 — Rollout:** Deploy on the gateway PC as a persistent service, test from
   2–3 different PCs on the LAN simultaneously.

## 9. Safety & Reliability Considerations (important for machinery control)
- Keep the **physical E-stop and local HMI fully functional** — the remote HMI should
  be an additional interface, not a replacement for hard safety controls.
- Add a confirmation step in the UI for Cycle Start (and definitely for anything that
  could be unsafe to trigger by an accidental click).
- If the WebSocket/network connection drops, the UI should clearly show "disconnected"
  rather than showing stale values as if they were live.
- Log every write command with a timestamp and (once logins exist) the user who sent
  it — useful for diagnosing "who started the machine" later.
- Rate-limit/queue writes so rapid double-clicks don't send duplicate commands to the
  PLC.

## 10. Security Considerations
- Restrict the gateway's web server to the local network only (no port-forwarding to
  the internet in the first version).
- Add authentication before allowing write access (read-only viewing can be more open
  if useful, e.g. for supervisors monitoring status).
- If remote-from-outside-the-building access is wanted later, use a VPN into the LAN
  rather than exposing the gateway's HTTP/WebSocket ports directly to the internet.

## 11. Testing & Rollout
- Test each control (Start, Stop, each Output, each SET value) individually against
  the real PLC before combining into a full UI flow.
- Test with the local physical HMI and the new web HMI both connected simultaneously
  to confirm they stay in sync and don't conflict.
- Test connection-loss recovery: unplug the USB/RS485 cable while the web HMI is open
  and confirm it reports disconnection cleanly rather than hanging or showing wrong
  values.
- Test from multiple client PCs on the LAN at once.

---

## Prompt to paste to your coding agent

> Build a Modbus RTU gateway + web HMI system. A PLC is connected via an RS485-to-USB
> adapter to a PC (Modbus RTU, serial). I need:
>
> 1. A gateway service (Node.js + `modbus-serial`, or Python + `pymodbus`) that:
>    - Connects over serial to the PLC (baud rate, parity, unit ID to be confirmed —
>      make these configurable, don't hardcode).
>    - Polls the following points continuously and caches the latest values:
>      [paste the register table from Section 6 here]
>    - Exposes the cached values plus write capability over a REST API and a
>      WebSocket for live push to browser clients.
>    - Implements Cycle Start/Cycle Stop as momentary pulses: write coil = 1, wait
>      ~300ms, write coil = 0 automatically — the client should never manage the reset.
>    - Handles 32-bit register reads/writes correctly across the two consecutive
>      16-bit registers (word order to be confirmed against the PLC's documentation —
>      make this configurable too).
>    - Detects and reports serial disconnection cleanly (don't silently serve stale
>      cached data as if it's live).
>    - Serializes/queues all writes so concurrent requests don't collide on the
>      half-duplex serial line.
> 2. A web frontend (React or plain HTML/JS) that mirrors the existing physical HMI:
>    Cycle Start/Stop buttons, Output 1–4 toggles with live state, On-time/Delay-time
>    SET inputs with an explicit "Apply" action, Running values shown read-only and
>    live, and a clear connected/disconnected status indicator.
> 3. Basic login/auth gating write access, and a log of every write command with
>    timestamp and user.
> 4. Deploy instructions for running the gateway as a persistent background service on
>    Windows (or Linux, specify which) so it survives reboots.
>
> Start by writing a small standalone test script that reads one coil and one register
> from the PLC to confirm the serial settings and 32-bit word order are correct before
> building the rest.av