# Camera Integration Setup Guide

## Overview
This guide covers three camera options for testing the safety detection and attendance systems without deployment hardware. All options work with the existing RTSP/MJPEG infrastructure.

---

## Option 1: Android IP Webcam (Recommended - Free)

### Cost: PKR 0 (Mobile phone you likely already have)
### Setup Time: 5 minutes
### Advantages: Instant setup, highest flexibility, video quality 720p-1080p

### Steps:

1. **Download IP Webcam App on Android Phone**
   ```
   - Open Google Play Store
   - Search for "IP Webcam" (by Pavel Khlebovich)
   - Install free version
   ```

2. **Configure IP Webcam**
   ```
   - Open app on phone
   - Tap "Settings" → "Video Preferences"
   - Resolution: Select 720p or 1080p
   - FPS: Set to 30fps for balance between quality and network load
   - Video Codec: H.264
   ```

3. **Start Streaming**
   ```
   - In app main screen, tap "Start server"
   - Note down the IP address shown (e.g., 192.168.1.100:8080)
   - Keep phone connected to same WiFi as laptop
   ```

4. **Test Stream Locally**
   ```bash
   # From your development machine:
   curl http://192.168.1.100:8080/video
   
   # Or in Python (from ai-service):
   python3 << 'EOF'
   import cv2
   rtsp_url = "http://192.168.1.100:8080/video"
   cap = cv2.VideoCapture(rtsp_url)
   
   if cap.isOpened():
       ret, frame = cap.read()
       if ret:
           print(f"✓ Camera connected! Resolution: {frame.shape}")
       else:
           print("✗ Cannot read frame")
       cap.release()
   else:
       print("✗ Cannot connect to camera")
   EOF
   ```

5. **Integration with Node.js Backend**
   ```javascript
   // In backend/routes/camera.js or similar:
   const cameraStreamURL = process.env.CAMERA_STREAM_URL || "http://192.168.1.100:8080/video";
   // Use this URL in the RTSP/MJPEG endpoints
   ```

---

## Option 2: USB Webcam (Simplest Alternative)

### Cost: PKR 1,500 - 3,000 (one-time, reusable)
### Setup Time: 2 minutes
### Advantages: Plug-and-play, direct USB connection, no networking complexity

### Steps:

1. **Connect USB Webcam to Development Machine**
   ```bash
   # Check if recognized:
   lsusb | grep -i camera
   # or
   ls -la /dev/video*
   ```

2. **Test Direct Capture**
   ```bash
   # Using ffmpeg:
   ffmpeg -f v4l2 -i /dev/video0 -vframes 1 test_frame.jpg
   
   # View the captured frame:
   display test_frame.jpg
   ```

3. **Create Local RTSP Server (ffmpeg)**
   ```bash
   # Install ffmpeg if needed:
   sudo apt-get install ffmpeg
   
   # Stream USB webcam as RTSP:
   ffmpeg -f v4l2 -i /dev/video0 -c:v libx264 -preset veryfast -tune zerolatency \
     -rtsp_transport tcp -f rtsp rtsp://localhost:8554/camera
   
   # Keep this terminal window open while testing
   ```

4. **Connect in Python (ai-service)**
   ```python
   import cv2
   
   # Option A: Direct USB
   cap = cv2.VideoCapture(0)  # /dev/video0
   
   # Option B: Via RTSP
   cap = cv2.VideoCapture("rtsp://localhost:8554/camera")
   
   ret, frame = cap.read()
   if ret:
       print(f"✓ USB camera ready! Size: {frame.shape}")
   ```

---

## Option 3: Laptop Built-in Webcam (Quickest)

### Cost: PKR 0 (already built-in)
### Setup Time: 1 minute
### Advantages: No external hardware needed, instant testing

### Steps:

1. **Test Direct Capture**
   ```bash
   # List available cameras:
   python3 << 'EOF'
   import cv2
   for i in range(5):
       cap = cv2.VideoCapture(i)
       if cap.isOpened():
           print(f"Camera {i} available: {cap.get(cv2.CAP_PROP_FRAME_WIDTH)}x{cap.get(cv2.CAP_PROP_FRAME_HEIGHT)}")
           cap.release()
   EOF
   ```

2. **Quick Test**
   ```python
   import cv2
   cap = cv2.VideoCapture(0)
   ret, frame = cap.read()
   cv2.imwrite('/tmp/webcam_test.jpg', frame)
   cap.release()
   print("Webcam test complete - image saved to /tmp/webcam_test.jpg")
   ```

3. **Use in Backend**
   ```javascript
   // Use device_id = 0 for built-in webcam
   const cameraConfig = {
       device: 0,  // or /dev/video0 on Linux
       resolution: "1280x720",
       fps: 30
   };
   ```

---

## Integration with BuildSite360 Backend

### Environment Configuration

Add to `.env.local` in project root:

```env
# Camera Configuration
CAMERA_TYPE=android_ip  # Options: android_ip, usb, builtin
CAMERA_SOURCE=http://192.168.1.100:8080/video  # For Android IP
CAMERA_DEVICE=/dev/video0  # For USB/builtin

# Stream Settings
STREAM_FORMAT=mjpeg  # or rtsp
STREAM_PORT=8554
STREAM_QUALITY=medium  # low, medium, high
STREAM_FPS=30

# For facial recognition testing
ATTENDANCE_MIN_FACE_SIZE=50  # pixels
ATTENDANCE_DISTANCE_THRESHOLD=0.65  # cosine similarity for DeepFace

# For safety detection testing
SAFETY_CONFIDENCE_THRESHOLD=0.5  # YOLOv8 confidence
SAFETY_ALERT_COOLDOWN=5  # seconds between alerts for same person
```

### Backend Stream Endpoint

Create `backend/routes/stream.js`:

```javascript
const express = require('express');
const cv = require('opencv4nodejs');
const router = express.Router();

let lastStreamTime = {};

router.get('/stream/safety', async (req, res) => {
    res.setHeader('Content-Type', 'multipart/x-mixed-replace; boundary=frame');
    
    try {
        const cameraSource = process.env.CAMERA_SOURCE || '/dev/video0';
        const cap = new cv.VideoCapture(cameraSource);
        
        const sendFrame = () => {
            const frame = cap.read();
            if (!frame.empty) {
                // YOLOv8 detection will be added here
                const jpeg = cv.imencode('.jpg', frame);
                res.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`);
                res.write(jpeg);
                res.write('\r\n');
                setTimeout(sendFrame, 33); // ~30fps
            }
        };
        
        sendFrame();
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/stream/attendance', async (req, res) => {
    // Similar implementation for attendance stream
    // Will show detected faces and enrollment status
});

module.exports = router;
```

### Frontend Display

In React component (`frontend/src/pages/LiveMonitoring.jsx`):

```jsx
import { useEffect, useRef } from 'react';

export default function LiveMonitoring() {
    const videoRef = useRef(null);
    
    useEffect(() => {
        const img = new Image();
        const updateStream = () => {
            img.src = `${process.env.REACT_APP_API_URL}/api/stream/safety?t=${Date.now()}`;
            if (videoRef.current) {
                videoRef.current.src = img.src;
            }
        };
        
        const interval = setInterval(updateStream, 100);
        return () => clearInterval(interval);
    }, []);
    
    return (
        <div className="live-monitoring">
            <img 
                ref={videoRef}
                style={{ maxWidth: '100%', borderRadius: '8px' }}
                alt="Live Stream"
            />
        </div>
    );
}
```

---

## Testing Each Setup

### Test 1: Frame Capture
```bash
# Run from ai-service directory:
python3 << 'EOF'
import cv2
import sys

camera_source = sys.argv[1] if len(sys.argv) > 1 else "/dev/video0"
cap = cv2.VideoCapture(camera_source)

if cap.isOpened():
    ret, frame = cap.read()
    if ret:
        cv2.imwrite('/tmp/camera_test.jpg', frame)
        print(f"✓ Frame captured: {frame.shape[0]}x{frame.shape[1]}")
    cap.release()
else:
    print(f"✗ Failed to open camera: {camera_source}")
EOF
```

### Test 2: Continuous Stream
```bash
python3 << 'EOF'
import cv2
import time

cap = cv2.VideoCapture("/dev/video0")
frame_count = 0
start_time = time.time()

while frame_count < 300:  # 10 seconds at 30fps
    ret, frame = cap.read()
    if ret:
        frame_count += 1
    else:
        print("Failed to grab frame")
        break

elapsed = time.time() - start_time
fps = frame_count / elapsed
print(f"✓ Captured {frame_count} frames in {elapsed:.2f}s ({fps:.1f} FPS)")
cap.release()
EOF
```

### Test 3: YOLOv8 Integration (Once Model Trained)
```bash
# Will be added after dataset training section
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| **Android IP Webcam won't connect** | Ensure phone and laptop are on same WiFi. Check firewall. Restart app. |
| **USB camera not detected** | Try `sudo chmod 666 /dev/video0`. Install `v4l-utils`: `sudo apt-get install v4l-utils`. Check `v4l2-ctl --list-devices`. |
| **Low FPS / lag** | Reduce resolution to 480p. Lower FPS to 15. Use faster codec (MJPEG instead of H.264). |
| **Frame frozen / disconnects** | Check network stability. Restart stream. For USB, check cable connection. |
| **Permission denied** | Run with `sudo` or add user to video group: `sudo usermod -aG video $USER`. Log out and back in. |
| **High CPU usage** | Reduce resolution. Use faster preset. Check if YOLOv8 model is running (will be added). |

---

## Recommended Testing Order

1. **Start with Android IP Webcam** - Fastest setup, most flexible
2. **If WiFi unstable** - Switch to USB webcam
3. **For integration testing** - Use built-in webcam as fallback
4. **Once confident** - Move to actual hardware cameras (TP-Link Tapo C200/C310)

---

## Next Steps

After camera is running:
1. Verify stream works in frontend Live Monitoring page
2. Test face detection (`DeepFace` on captured frames)
3. Test safety detection (after YOLOv8 model training)
4. Integrate with real-time alerts

**Important**: Keep camera stream running in separate terminal while testing other components.
