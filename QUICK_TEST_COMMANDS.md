# BuildSite 360 - Quick Test Commands Reference

**Copy & Paste Testing Prompts for Immediate Use**

---

## 🚀 Quick Setup (Run Once)

```bash
# Terminal 1: Go to project
cd C:\Projects\FYP

# Terminal 2: Start MinIO S3
set MINIO_ROOT_USER=minioadmin & set MINIO_ROOT_PASSWORD=minioadmin & minio.exe server .\minio-data --address ":9000" --console-address ":9001"

# Terminal 3: Start API Server
cd server && npm run dev

# Terminal 4: Start React
cd client && npm run dev

# Terminal 5: Start Python AI Service
cd ai-service && venv\Scripts\activate && python main.py

# Terminal 6: Seed Database
cd server && npm run seed
# SAVE THE TOKENS PRINTED!
```

---

## ✅ Health Checks (Verify All Services Running)

```bash
# Test 1: API Health
curl http://localhost:3000/api/health

# Test 2: AI Service Health
curl http://localhost:8000/health

# Test 3: Browser - Open URL
http://localhost:5173

# Test 4: MinIO Console
http://localhost:9001 (login: minioadmin/minioadmin)
```

---

## 🔐 Authentication Tests

**Prompt 1: Register New User**
```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d {\"name\":\"Test User\",\"email\":\"test@example.com\",\"password\":\"Test123!\",\"role\":\"ENGINEER\"}
```

**Prompt 2: Login (Get Tokens)**
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d {\"email\":\"admin@test.com\",\"password\":\"password123\"}
```

**Prompt 3: Get Current User**
```bash
# Replace {TOKEN} with token from Prompt 2
curl -X GET http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer {TOKEN}"
```

**Prompt 4: Logout**
```bash
curl -X POST http://localhost:3000/api/auth/logout \
  -H "Authorization: Bearer {TOKEN}"
```

---

## 📊 Project Management Tests

**Prompt 5: Create Project**
```bash
curl -X POST http://localhost:3000/api/projects \
  -H "Authorization: Bearer {ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d {\"name\":\"Test Project\",\"gpsLat\":40.7128,\"gpsLng\":-74.0060,\"address\":\"123 Main St\",\"clientId\":\"{CLIENT_ID}\",\"startDate\":\"2024-09-01T00:00:00Z\",\"expectedCompletionDate\":\"2024-12-31T00:00:00Z\",\"budgetEstimate\":500000}
```

**Prompt 6: List All Projects (ADMIN)**
```bash
curl -X GET http://localhost:3000/api/projects \
  -H "Authorization: Bearer {ADMIN_TOKEN}"
```

**Prompt 7: List Engineer's Projects (Role-Scoped)**
```bash
curl -X GET http://localhost:3000/api/projects \
  -H "Authorization: Bearer {ENGINEER_TOKEN}"
```

**Prompt 8: Get Project Details**
```bash
curl -X GET http://localhost:3000/api/projects/{PROJECT_ID} \
  -H "Authorization: Bearer {ADMIN_TOKEN}"
```

**Prompt 9: Update Project**
```bash
curl -X PUT http://localhost:3000/api/projects/{PROJECT_ID} \
  -H "Authorization: Bearer {ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d {\"status\":\"ACTIVE\",\"name\":\"Updated Project Name\"}
```

**Prompt 10: Assign Engineer to Project**
```bash
curl -X POST http://localhost:3000/api/projects/{PROJECT_ID}/assign-engineer \
  -H "Authorization: Bearer {ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d {\"engineerId\":\"{ENGINEER_ID}\"}
```

---

## 📸 Site Updates & Media Tests

**Prompt 11: Get Presigned S3 URL**
```bash
curl -X POST http://localhost:3000/api/projects/{PROJECT_ID}/updates/presign \
  -H "Authorization: Bearer {ENGINEER_TOKEN}" \
  -H "Content-Type: application/json" \
  -d {\"fileName\":\"photo.jpg\",\"contentType\":\"image/jpeg\"}
```

**Prompt 12: Save Site Update**
```bash
curl -X POST http://localhost:3000/api/projects/{PROJECT_ID}/updates \
  -H "Authorization: Bearer {ENGINEER_TOKEN}" \
  -H "Content-Type: application/json" \
  -d {\"description\":\"Foundation work completed\",\"mediaUrls\":[\"http://localhost:9000/buildsite360/photo.jpg\"],\"mediaType\":\"IMAGE\"}
```

**Prompt 13: List Updates**
```bash
curl -X GET http://localhost:3000/api/projects/{PROJECT_ID}/updates \
  -H "Authorization: Bearer {ENGINEER_TOKEN}"
```

---

## 📦 Material Management Tests

**Prompt 14: Add Material (RECEIVED)**
```bash
curl -X POST http://localhost:3000/api/projects/{PROJECT_ID}/materials \
  -H "Authorization: Bearer {ENGINEER_TOKEN}" \
  -H "Content-Type: application/json" \
  -d {\"name\":\"Steel Reinforcement\",\"category\":\"Structural\",\"entryType\":\"RECEIVED\",\"quantity\":100,\"unitCost\":50.00,\"date\":\"2024-08-22T10:00:00Z\"}
```

**Prompt 15: Add Material (CONSUMED)**
```bash
curl -X POST http://localhost:3000/api/projects/{PROJECT_ID}/materials \
  -H "Authorization: Bearer {ENGINEER_TOKEN}" \
  -H "Content-Type: application/json" \
  -d {\"name\":\"Steel Reinforcement\",\"category\":\"Structural\",\"entryType\":\"CONSUMED\",\"quantity\":60,\"unitCost\":50.00,\"date\":\"2024-08-22T14:00:00Z\"}
```

**Prompt 16: List Materials**
```bash
curl -X GET http://localhost:3000/api/projects/{PROJECT_ID}/materials \
  -H "Authorization: Bearer {ENGINEER_TOKEN}"
```

**Prompt 17: Get Material Summary (with Discrepancy)**
```bash
curl -X GET http://localhost:3000/api/projects/{PROJECT_ID}/materials/summary \
  -H "Authorization: Bearer {ENGINEER_TOKEN}"
```

---

## 💬 Real-Time Chat Tests

**Prompt 18: Get Chat History**
```bash
curl -X GET http://localhost:3000/api/projects/{PROJECT_ID}/chat/history \
  -H "Authorization: Bearer {ENGINEER_TOKEN}"
```

**Prompt 19: Connect WebSocket & Send Message**
Open browser console (F12) and run:
```javascript
// Connect WebSocket
const socket = io('http://localhost:3000', {
  auth: { token: '{TOKEN}' }
});

// Join project room
socket.emit('project:join', { projectId: '{PROJECT_ID}' });

// Send message
socket.emit('chat:send', {
  projectId: '{PROJECT_ID}',
  content: 'Test message from localhost'
});

// Listen for messages
socket.on('chat:message', (msg) => {
  console.log('New message:', msg);
});
```

---

## 📹 Camera Streaming Tests

**Prompt 20: Register Camera**
```bash
curl -X POST http://localhost:3000/api/projects/{PROJECT_ID}/cameras \
  -H "Authorization: Bearer {ENGINEER_TOKEN}" \
  -H "Content-Type: application/json" \
  -d {\"name\":\"Entrance Gate\",\"zone\":\"ENTRANCE\",\"rtspUrl\":\"rtsp://127.0.0.1:8554/testcam\"}
```

**Prompt 21: List Cameras**
```bash
curl -X GET http://localhost:3000/api/projects/{PROJECT_ID}/cameras \
  -H "Authorization: Bearer {ENGINEER_TOKEN}"
```

**Prompt 22: View MJPEG Stream (Browser)**
Open in browser:
```
http://localhost:3000/api/cameras/{CAMERA_ID}/stream
```

**Prompt 23: Record 30-Second Clip**
```bash
curl -X POST http://localhost:3000/api/cameras/{CAMERA_ID}/record-clip \
  -H "Authorization: Bearer {ENGINEER_TOKEN}"
```

---

## 🚨 Safety Detection Tests

**Prompt 24: Simulate Safety Alert**
```bash
curl -X POST http://localhost:3000/api/internal/safety-alert \
  -H "X-Internal-Token: {INTERNAL_TOKEN}" \
  -H "Content-Type: application/json" \
  -d {\"cameraId\":\"{CAMERA_ID}\",\"violationType\":\"NO_HELMET\",\"confidence\":0.95,\"frameImageBase64\":\"data:image/jpeg;base64,/9j/4AAQSkZJRg...\"}
```

**Prompt 25: List Safety Alerts**
```bash
curl -X GET http://localhost:3000/api/projects/{PROJECT_ID}/safety-alerts \
  -H "Authorization: Bearer {ENGINEER_TOKEN}"
```

**Prompt 26: Listen for Real-Time Safety Alerts (WebSocket)**
```javascript
// In browser console (continue from socket)
socket.on('safety:alert', (alert) => {
  console.log('🚨 Violation:', alert);
});
```

---

## 👥 Attendance Tracking Tests

**Prompt 27: Enroll Worker**
```bash
curl -X POST http://localhost:3000/api/projects/{PROJECT_ID}/workers/enroll \
  -H "Authorization: Bearer {ENGINEER_TOKEN}" \
  -H "Content-Type: application/json" \
  -d {\"name\":\"John Smith\",\"employeeId\":\"EMP-001\",\"photos\":[\"data:image/jpeg;base64,/9j/4AAQSkZJRg...\"]}
```

**Prompt 28: Check Daily Attendance**
```bash
curl -X GET "http://localhost:3000/api/projects/{PROJECT_ID}/attendance?range=daily" \
  -H "Authorization: Bearer {ENGINEER_TOKEN}"
```

**Prompt 29: Check Weekly Attendance**
```bash
curl -X GET "http://localhost:3000/api/projects/{PROJECT_ID}/attendance?range=weekly" \
  -H "Authorization: Bearer {ENGINEER_TOKEN}"
```

**Prompt 30: Listen for Check-In (WebSocket)**
```javascript
socket.on('attendance:checkin', (record) => {
  console.log('✅ Worker checked in:', record);
});
```

---

## 📊 Analytics & Reports Tests

**Prompt 31: Get Project Analytics**
```bash
curl -X GET http://localhost:3000/api/projects/{PROJECT_ID}/analytics \
  -H "Authorization: Bearer {ENGINEER_TOKEN}"
```

**Prompt 32: Generate Report Now (Admin)**
```bash
curl -X POST http://localhost:3000/api/projects/{PROJECT_ID}/reports/generate-now \
  -H "Authorization: Bearer {ADMIN_TOKEN}"
```

**Prompt 33: List Reports**
```bash
curl -X GET http://localhost:3000/api/projects/{PROJECT_ID}/reports \
  -H "Authorization: Bearer {ADMIN_TOKEN}"
```

---

## 💳 Billing Tests

**Prompt 34: Get Subscription**
```bash
curl -X GET http://localhost:3000/api/billing/subscription \
  -H "Authorization: Bearer {ADMIN_TOKEN}"
```

**Prompt 35: Initiate Checkout**
```bash
curl -X POST http://localhost:3000/api/billing/checkout \
  -H "Authorization: Bearer {ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d {\"plan\":\"PRO\",\"provider\":\"EASYPAISA\"}
```

**Prompt 36: Simulate Payment Webhook**
```bash
curl -X POST http://localhost:3000/api/billing/webhook/easypaisa \
  -H "Content-Type: application/json" \
  -d {\"transactionId\":\"EZP-123456\",\"status\":\"SUCCESS\",\"amount\":9999}
```

---

## 🧪 Automated Testing

**Prompt 37: Run Postman Collection**
```bash
cd server

# Install newman if not already done
npm install -g newman

# Run tests
newman run postman_collection.json \
  --environment tests/newman-env.json

# Expected: All tests pass
```

**Prompt 38: Run E2E Tests**
```bash
cd server
npm run test:e2e
```

---

## 🐛 Debugging & Troubleshooting

**Prompt 39: Check Database Connection**
```bash
cd server
npx prisma db execute --stdin < select_version()
```

**Prompt 40: View Database in UI**
```bash
cd server
npx prisma studio
# Opens http://localhost:5555
```

**Prompt 41: Check Server Logs**
```bash
# Look at server terminal window for errors
# Common issues:
# - "Cannot find module" → npm install
# - "DATABASE_URL" not set → check .env
# - "Port 3000 in use" → kill process or change PORT in .env
```

**Prompt 42: Test S3 Connection**
```bash
curl -X GET http://localhost:9000/ \
  -H "Authorization: AWS4-HMAC-SHA256 Credential=minioadmin/20240822/us-east-1/s3/aws4_request"
```

---

## 📝 Test Results Template

**Copy this and fill in as you test:**

```
PROJECT TESTING RESULTS - August 22, 2026
==========================================

Phase 0: Environment & Foundation
- [ ] All 4 services start without errors
- [ ] Health checks return 200 OK
- [ ] Database connects and migrations applied
- [ ] MinIO S3 accessible at port 9000
- [ ] React loads at localhost:5173

Phase 1: Authentication
- [ ] Register user works
- [ ] Login returns access token
- [ ] Get current user works
- [ ] Logout clears token
- [ ] Protected routes require token

Phase 2: Project Management
- [ ] Admin creates project
- [ ] Admin sees all projects
- [ ] Engineer sees only assigned
- [ ] Client sees only owned
- [ ] Update and delete work

Phase 3: Site Updates
- [ ] Presign URL obtained
- [ ] File upload to S3 works
- [ ] Update record saved
- [ ] Can list updates

Phase 4: Materials
- [ ] Add received materials
- [ ] Add consumed materials
- [ ] Summary calculates correctly
- [ ] Discrepancy flag works

Phase 5: Chat
- [ ] WebSocket connects
- [ ] Messages send real-time
- [ ] History loads
- [ ] File attachments work

Phase 6: Cameras
- [ ] Register camera
- [ ] List cameras
- [ ] Stream displays (if setup)
- [ ] Record clip works

Phase 7: AI Models
- [ ] YOLOv8 weights loaded
- [ ] Face embedding generated
- [ ] Inference scripts work

Phase 8: Safety Detection
- [ ] Alerts create correctly
- [ ] Confidence scores saved
- [ ] Real-time notifications
- [ ] Alert history available

Phase 9: Attendance
- [ ] Worker enrolled
- [ ] Check-in recorded
- [ ] Daily/weekly views work
- [ ] No duplicates per day

Phase 10: Analytics
- [ ] Summary data returns
- [ ] Charts display
- [ ] Reports generate
- [ ] PDFs download

Phase 11: Billing
- [ ] Subscription retrieved
- [ ] Checkout initiated
- [ ] Webhook processed
- [ ] Plan limits enforced

Phase 12: Testing
- [ ] Postman collection passes
- [ ] E2E tests pass
- [ ] Seed script works
- [ ] Negative path tests pass

Phase 13: UI/UX
- [ ] All pages load
- [ ] Responsive on tablet
- [ ] Design system consistent
- [ ] No console errors

TOTAL TESTS PASSED: ___ / 162
STATUS: [ ] Ready for Deployment
```

---

## 🎯 Testing by Role

### As Administrator
```bash
# Login
ADMIN_TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@test.com","password":"password123"}' \
  | grep -o '"accessToken":"[^"]*' | grep -o '[^"]*$')

# Create project
curl -X POST http://localhost:3000/api/projects \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Admin Test","gpsLat":0,"gpsLng":0,"address":"Test","clientId":"UUID","startDate":"2024-01-01T00:00:00Z","expectedCompletionDate":"2024-12-31T00:00:00Z","budgetEstimate":100000}'

# Generate report
curl -X POST http://localhost:3000/api/projects/{PROJECT_ID}/reports/generate-now \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

### As Engineer
```bash
# Login
ENGINEER_TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"engineer1@test.com","password":"password123"}' \
  | grep -o '"accessToken":"[^"]*' | grep -o '[^"]*$')

# Create material entry
curl -X POST http://localhost:3000/api/projects/{PROJECT_ID}/materials \
  -H "Authorization: Bearer $ENGINEER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Cement","category":"Materials","entryType":"RECEIVED","quantity":50,"unitCost":25.00,"date":"2024-08-22T00:00:00Z"}'

# List your projects
curl -X GET http://localhost:3000/api/projects \
  -H "Authorization: Bearer $ENGINEER_TOKEN"
```

### As Client
```bash
# Login
CLIENT_TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"client1@test.com","password":"password123"}' \
  | grep -o '"accessToken":"[^"]*' | grep -o '[^"]*$')

# View your projects only
curl -X GET http://localhost:3000/api/projects \
  -H "Authorization: Bearer $CLIENT_TOKEN"

# View analytics
curl -X GET http://localhost:3000/api/projects/{YOUR_PROJECT_ID}/analytics \
  -H "Authorization: Bearer $CLIENT_TOKEN"
```

---

## 🏃 Quick 10-Minute Test

```bash
# 1. Health checks (30 sec)
curl http://localhost:3000/api/health
curl http://localhost:8000/health

# 2. Login (30 sec)
ADMIN_TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@test.com","password":"password123"}' \
  | grep -o '"accessToken":"[^"]*' | grep -o '[^"]*$')

# 3. Create project (1 min)
curl -X POST http://localhost:3000/api/projects \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Quick Test","gpsLat":0,"gpsLng":0,"address":"Test","clientId":"UUID","startDate":"2024-01-01T00:00:00Z","expectedCompletionDate":"2024-12-31T00:00:00Z","budgetEstimate":100000}'

# 4. List projects (30 sec)
curl -X GET http://localhost:3000/api/projects \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# 5. Add material (1 min)
curl -X POST http://localhost:3000/api/projects/{PROJECT_ID}/materials \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","category":"Test","entryType":"RECEIVED","quantity":10,"unitCost":10,"date":"2024-08-22T00:00:00Z"}'

# 6. Get summary (30 sec)
curl -X GET http://localhost:3000/api/projects/{PROJECT_ID}/materials/summary \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# 7. Open browser (3 min)
# Open http://localhost:5173
# Login as admin@test.com/password123
# Verify dashboard loads
# Click on project
# Verify project detail page

# 8. Check real-time chat (2 min)
# Open browser console
# Paste WebSocket code from Prompt 19
# Send test message
# Verify it appears

TOTAL TIME: ~10 minutes
```

---

## 📞 Support & Escalation

If a test fails:

1. **Check the error message** - copy exact error
2. **Check service logs** - look at terminal where service is running
3. **Verify prerequisites** - database running, tokens valid, etc.
4. **Try the full guide** - refer to LOCAL_TESTING_GUIDE.md for detailed steps
5. **Check environment** - verify .env files have correct URLs and credentials

Common fixes:
- Service not running? Start it (see Quick Setup section)
- Invalid token? Get new one (run Prompt 2: Login)
- Database error? Check DATABASE_URL in .env
- Port already in use? Kill process: `lsof -i :3000` then kill
- CORS error? Restart server (code changes require restart)

---

**Last Updated:** August 22, 2026  
**All 162 Features Ready to Test** ✅

