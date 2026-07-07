import { useState, useEffect, useRef } from 'react';
import './index.css';

const API_BASE = 'http://localhost:3001/api';
const WS_URL = 'ws://localhost:3001/ws/live';
const SECRET_KEY = 'my_super_secret_key_change_in_production'; // Simple hardcoded auth for demo

function App() {
  const [status, setStatus] = useState('disconnected');
  const [data, setData] = useState({
    coils: {},
    inputRegisters: {},
    holdingRegisters: {}
  });
  
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  
  // Local state for SET inputs so they don't jump around while typing
  const [setValues, setSetValues] = useState({});

  const ws = useRef(null);

  useEffect(() => {
    connectWebSocket();
    return () => {
      if (ws.current) ws.current.close();
    };
  }, []);

  const connectWebSocket = () => {
    ws.current = new WebSocket(WS_URL);
    
    ws.current.onopen = () => {
      console.log("WebSocket connected");
      // Initially assume PLC is connected if WS is open, until we receive real status
    };
    
    ws.current.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        setStatus(payload.status);
        setData({
          coils: payload.coils || {},
          inputRegisters: payload.inputRegisters || {},
          holdingRegisters: payload.holdingRegisters || {}
        });
        
        // Only initialize set values if they are empty
        setSetValues(prev => {
          if (Object.keys(prev).length === 0 && payload.holdingRegisters) {
            return payload.holdingRegisters;
          }
          return prev;
        });
        
      } catch (e) {
        console.error("Invalid WS message", e);
      }
    };
    
    ws.current.onclose = () => {
      console.log("WebSocket disconnected");
      setStatus('disconnected');
      setTimeout(connectWebSocket, 3000); // Reconnect
    };
  };

  const handleLogin = (e) => {
    e.preventDefault();
    if (password === 'admin123') { // Very basic auth
      setIsAuthenticated(true);
    } else {
      alert('Invalid password');
    }
  };

  const sendWrite = async (type, point, value) => {
    if (!isAuthenticated) return alert("Please log in first.");
    
    // Optimistic local update (optional, but makes UI feel snappy)
    
    try {
      const res = await fetch(`${API_BASE}/write`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SECRET_KEY}`
        },
        body: JSON.stringify({ type, point, value })
      });
      
      const result = await res.json();
      if (!result.success) {
        alert("Write failed: " + result.error);
      }
    } catch (e) {
      alert("Network error: " + e.message);
    }
  };

  const isConnected = status === 'connected';

  if (!isAuthenticated) {
    return (
      <div className="login-overlay">
        <form className="login-modal" onSubmit={handleLogin}>
          <h2>Gateway Login</h2>
          <input 
            type="password" 
            className="input-field" 
            placeholder="Password (admin123)"
            value={password}
            onChange={e => setPassword(e.target.value)}
          />
          <button type="submit" className="btn btn-apply" style={{width: '100%'}}>Login</button>
        </form>
      </div>
    );
  }

  return (
    <div className="app-container">
      <header className="header">
        <h1>Remote PLC HMI</h1>
        <div className={`status-badge status-${status}`}>
          <div className="status-dot"></div>
          {status.toUpperCase()}
        </div>
      </header>

      <div className="grid">
        {/* Main Controls Panel */}
        <div className="panel">
          <h2>Machine Controls</h2>
          <div className="control-group">
            <div className="control-item">
              <span className="control-label">Cycle Start</span>
              <button 
                className="btn btn-start"
                disabled={!isConnected}
                onClick={() => {
                  if(confirm("Are you sure you want to start the cycle?")) {
                    sendWrite('coil', 'cycleStart', true);
                  }
                }}
              >
                Start
              </button>
            </div>
            
            <div className="control-item">
              <span className="control-label">Cycle Stop</span>
              <button 
                className="btn btn-stop"
                disabled={!isConnected}
                onClick={() => sendWrite('coil', 'cycleStop', true)}
              >
                Stop
              </button>
            </div>
          </div>
        </div>

        {/* Outputs Panel */}
        <div className="panel">
          <h2>Outputs</h2>
          <div className="control-group">
            {[1, 2, 3, 4].map(num => {
              const point = `output${num}`;
              const val = !!data.coils[point];
              return (
                <div className="control-item" key={point}>
                  <span className="control-label">Output {num}</span>
                  <label className="toggle">
                    <input 
                      type="checkbox" 
                      checked={val}
                      disabled={!isConnected}
                      onChange={(e) => sendWrite('coil', point, e.target.checked)}
                    />
                    <span className="slider"></span>
                  </label>
                </div>
              );
            })}
          </div>
        </div>

        {/* Timing Settings Panel */}
        <div className="panel" style={{gridColumn: '1 / -1'}}>
          <h2>Timing Configuration</h2>
          <div className="grid" style={{gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))'}}>
            
            {[
              { id: 'output1OnTime', label: 'Out 1 On Time' },
              { id: 'output2OnTime', label: 'Out 2 On Time' },
              { id: 'output3OnTime', label: 'Out 3 On Time' },
              { id: 'output4OnTime', label: 'Out 4 On Time' },
              { id: 'delayTime', label: 'Delay Time' },
            ].map(setting => (
              <div className="control-item" style={{flexDirection: 'column', alignItems: 'flex-start', gap: '1rem'}} key={setting.id}>
                <span className="control-label">{setting.label}</span>
                
                <div style={{display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center'}}>
                  <div style={{fontSize: '0.8rem', color: 'var(--text-muted)'}}>
                    Live (ms):
                    <div className="value-display" style={{marginTop: '0.25rem'}}>
                      {data.inputRegisters[setting.id] ?? '---'}
                    </div>
                  </div>
                  
                  <div className="input-group">
                    <input 
                      type="number"
                      className="input-field"
                      disabled={!isConnected}
                      value={setValues[setting.id] || ''}
                      onChange={e => setSetValues({...setValues, [setting.id]: parseInt(e.target.value, 10) || 0})}
                    />
                    <button 
                      className="btn btn-apply"
                      disabled={!isConnected}
                      onClick={() => sendWrite('holding', setting.id, setValues[setting.id])}
                    >
                      Apply
                    </button>
                  </div>
                </div>
              </div>
            ))}
            
          </div>
        </div>

      </div>
    </div>
  );
}

export default App;
