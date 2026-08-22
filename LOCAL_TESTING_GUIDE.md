# BuildSite 360 - Local Testing Guide

**Testing Environment:** Localhost Development  
**Date:** August 22, 2026

---

## 🚀 Prerequisites & Setup

Before testing, ensure you have:

```bash
# Check versions
node --version          # Should be v20+
python --version        # Should be 3.10 or 3.11
npm --version          # Should be 8+
git --version          # Should be 2.0+
```

### Step 1: Clone & Install Dependencies

```bash
# Navigate to project
cd C:\Projects\FYP

# Install server dependencies
cd server && npm install && cd ..

# Install client dependencies  
cd client && npm install && cd ..

# Install Python AI service
cd ai-service && python -m venv venv && venv\Scripts\activate && pip install -r requirements.txt && cd ..
```

### Step 2: Environment Configuration

```bash
# Copy .env files from examples
copy server\.env.example server\.env
copy client\.env.example client\.env.local
copy ai-service\.env.example ai-service\.env

# Verify files were created
dir server\.env client\.env.local ai-service\.env
```

### Step 3: Database Setup (PostgreSQL or Supabase)

**Option A: Local PostgreSQL**
```bash
# Windows: Start PostgreSQL service (should auto-start)
# Verify it's running on port 5432

# Update DATABASE_URL in server/.env:
# DATABASE_URL="postgresql://user:password@localhost:5432/buildsite360"
```

**Option B: Supabase (Recommended for Testing)**
```bash
# Create free account at supabase.com
# Create new project
# Get connection string from Project Settings > Database
# Update server/.env:
# DATABASE_URL="postgresql://[user]:[password]@[host]:5432/[database]"
```

### Step 4: Run Database Migrations

```bash
cd server
npx prisma migrate dev --name init
# This creates all tables from schema.prisma

# Verify tables were created
npx prisma studio
# Opens browser UI to view database
```

### Step 5: Seed Test Data

```bash
cd server
npm run seed
# Output will show test user credentials and tokens
```

**Expected Output:**
```
✅ Admin User Created: admin@test.com (password123)
✅ Engineer 1: engineer1@test.com (password123)
✅ Engineer 2: engineer2@test.com (password123)
✅ Client 1: client1@test.com (password123)
✅ Client 2: client2@test.com (password123)
✅ Project 1 (Riverside Tower): [PROJECT_ID_1]
✅ Project 2 (Lakeside Villas): [PROJECT_ID_2]

Admin Token: eyJhbGciOiJIUzI1NiIs...
Engineer Token: eyJhbGciOiJIUzI1NiIs...
Client Token: eyJhbGciOiJIUzI1NiIs...
```

**⚠️ Important:** Save these tokens - you'll use them for API testing!

---

## 📋 Service Startup (4 Terminals)

Open 4 separate terminal windows and run these commands in order:

### Terminal 1: MinIO (S3 Storage)

```bash
# Windows standalone binary method
set MINIO_ROOT_USER=minioadmin
set MINIO_ROOT_PASSWORD=minioadmin
minio.exe server .\minio-data --address ":9000" --console-address ":9001"

# Expected Output:
# ┌─────────────────────────────────────┐
# │ MinIO Object Storage Server         │
# │ Object URL: http://localhost:9000   │
# │ Console URL: http://localhost:9001  │
# └─────────────────────────────────────┘
```

**Verify:** Open http://localhost:9001 (login: minioadmin/minioadmin)

### Terminal 2: Node.js API Server

```bash
cd server
npm run dev

# Expected Output:
# [nodemon] watching extension: js,json
# ✅ Server running on http://localhost:3000
# ✅ Database connected
# ✅ Socket.io listening for real-time events
```

**Verify:** `curl http://localhost:3000/api/health` → `{"status":"ok"}`

### Terminal 3: React Client

```bash
cd client
npm run dev

# Expected Output:
# ➜  Local:   http://localhost:5173/
# ➜  press h to show help
```

**Verify:** Open http://localhost:5173 in browser → You should see the login page

### Terminal 4: Python AI Service

```bash
cd ai-service
venv\Scripts\activate
python main.py

# Expected Output:
# Uvicorn running on http://127.0.0.1:8000
# GET /health returns {"status": "ok"}
```

**Verify:** `curl http://localhost:8000/health` → `{"status":"ok"}`

---

## ✅ Health Check Tests

Run these to verify all services are running:

```bash
# Terminal 5 (New) - Run all checks at once

# API Health
curl http://localhost:3000/api/health
# Expected: {"status":"ok"}

# Python AI Service
curl http://localhost:8000/health
# Expected: {"status":"ok"}

# Client (Browser)
# Open http://localhost:5173
# Expected: Login page loads, "Disconnected" state initially
```

---

## 🔐 Phase 1: Authentication Testing

### Test 1.1: User Registration

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d {
    "name": "Test User",
    "email": "testuser@example.com",
    "password": "TestPassword123!",
    "role": "ENGINEER"
  }

# Expected Response (201):
# {
#   "id": "uuid-123",
#   "name": "Test User",
#   "email": "testuser@example.com",
#   "role": "ENGINEER",
#   "createdAt": "2024-08-22T..."
# }
```

### Test 1.2: User Login

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d {
    "email": "admin@test.com",
    "password": "password123"
  }

# Expected Response (200):
# {
#   "user": {...},
#   "accessToken": "eyJhbGciOiJIUzI1NiIs..."
# }
# 
# Also sets httpOnly cookie: refreshToken
```

**💾 Save the accessToken from response** - you'll use it below as `{TOKEN}`

### Test 1.3: Get Current User

```bash
curl -X GET http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer {TOKEN}"

# Expected Response (200):
# {
#   "id": "uuid-123",
#   "name": "Admin User",
#   "email": "admin@test.com",
#   "role": "ADMIN",
#   "createdAt": "..."
# }
```

### Test 1.4: Refresh Token

```bash
curl -X POST http://localhost:3000/api/auth/refresh \
  -H "Cookie: refreshToken={REFRESH_TOKEN}"

# Expected Response (200):
# {
#   "accessToken": "eyJhbGciOiJIUzI1NiIs..."
# }
```

### Test 1.5: Logout

```bash
curl -X POST http://localhost:3000/api/auth/logout \
  -H "Authorization: Bearer {TOKEN}" \
  -H "Cookie: refreshToken={REFRESH_TOKEN}"

# Expected Response (200):
# { "message": "Logged out successfully" }
```

**Expected Result:** ✅ All authentication flows working

---

## 📊 Phase 2: Project Management Testing

**Setup:** Use the ADMIN token from seed script

### Test 2.1: Create Project

```bash
curl -X POST http://localhost:3000/api/projects \
  -H "Authorization: Bearer {ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d {
    "name": "Downtown Mall Renovation",
    "gpsLat": 40.7128,
    "gpsLng": -74.0060,
    "address": "123 Main St, New York, NY",
    "clientId": "{CLIENT_USER_ID}",
    "startDate": "2024-09-01T00:00:00Z",
    "expectedCompletionDate": "2024-12-31T00:00:00Z",
    "budgetEstimate": 500000,
    "engineerIds": ["{ENGINEER_ID_1}", "{ENGINEER_ID_2}"]
  }

# Expected Response (201):
# {
#   "id": "project-uuid-123",
#   "name": "Downtown Mall Renovation",
#   "status": "PLANNING",
#   ...
# }
```

**💾 Save the project ID** - you'll use it for other tests

### Test 2.2: List Projects (ADMIN)

```bash
curl -X GET http://localhost:3000/api/projects \
  -H "Authorization: Bearer {ADMIN_TOKEN}"

# Expected Response (200): Array of all projects
# [
#   { "id": "...", "name": "Downtown Mall Renovation", ... },
#   { "id": "...", "name": "Riverside Tower", ... },
#   ...
# ]
```

### Test 2.3: List Projects (ENGINEER - Role-Scoped)

```bash
curl -X GET http://localhost:3000/api/projects \
  -H "Authorization: Bearer {ENGINEER_TOKEN}"

# Expected Response (200): Only projects assigned to this engineer
# [
#   { "id": "...", "name": "Riverside Tower", ... }
# ]
```

### Test 2.4: List Projects (CLIENT - Role-Scoped)

```bash
curl -X GET http://localhost:3000/api/projects \
  -H "Authorization: Bearer {CLIENT_TOKEN}"

# Expected Response (200): Only projects owned by this client
# [
#   { "id": "...", "name": "Riverside Tower", ... }
# ]
```

### Test 2.5: Get Project Details

```bash
curl -X GET http://localhost:3000/api/projects/{PROJECT_ID} \
  -H "Authorization: Bearer {ADMIN_TOKEN}"

# Expected Response (200):
# {
#   "id": "{PROJECT_ID}",
#   "name": "Downtown Mall Renovation",
#   "gpsLat": 40.7128,
#   "gpsLng": -74.0060,
#   "status": "PLANNING",
#   "engineers": [
#     { "id": "...", "name": "Engineer 1", ... }
#   ],
#   ...
# }
```

### Test 2.6: Update Project

```bash
curl -X PUT http://localhost:3000/api/projects/{PROJECT_ID} \
  -H "Authorization: Bearer {ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d {
    "status": "ACTIVE",
    "name": "Downtown Mall Renovation - Phase 2"
  }

# Expected Response (200): Updated project object
```

### Test 2.7: Assign Engineer

```bash
curl -X POST http://localhost:3000/api/projects/{PROJECT_ID}/assign-engineer \
  -H "Authorization: Bearer {ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d {
    "engineerId": "{NEW_ENGINEER_ID}"
  }

# Expected Response (201):
# {
#   "message": "Engineer assigned successfully",
#   "projectEngineer": { ... }
# }
```

**Expected Result:** ✅ All project CRUD operations working with proper role scoping

---

## 📸 Phase 3: Site Updates Testing

**Setup:** Use ENGINEER token, have a PROJECT_ID assigned to this engineer

### Test 3.1: Get Presigned S3 URL

```bash
curl -X POST http://localhost:3000/api/projects/{PROJECT_ID}/updates/presign \
  -H "Authorization: Bearer {ENGINEER_TOKEN}" \
  -H "Content-Type: application/json" \
  -d {
    "fileName": "site-photo-20240822.jpg",
    "contentType": "image/jpeg"
  }

# Expected Response (200):
# {
#   "presignedUrl": "http://localhost:9000/buildsite360/...",
#   "publicUrl": "http://localhost:9000/buildsite360/..."
# }
```

**💾 Save the presignedUrl**

### Test 3.2: Upload File to S3 (Simulated)

```bash
# Create a test image file
# (In practice, use actual image)
echo "test image data" > test-image.txt

# Upload to presigned URL
curl -X PUT "http://localhost:9000/buildsite360/{file-path}" \
  -H "Content-Type: image/jpeg" \
  --data-binary @test-image.txt

# Expected Response (200): Empty body (S3 indicates success)
```

### Test 3.3: Save Site Update Record

```bash
curl -X POST http://localhost:3000/api/projects/{PROJECT_ID}/updates \
  -H "Authorization: Bearer {ENGINEER_TOKEN}" \
  -H "Content-Type: application/json" \
  -d {
    "description": "First week concrete foundation work completed. Preparing for structural steel.",
    "mediaUrls": ["http://localhost:9000/buildsite360/site-photo-1.jpg"],
    "mediaType": "IMAGE"
  }

# Expected Response (201):
# {
#   "id": "update-uuid-123",
#   "projectId": "{PROJECT_ID}",
#   "engineerId": "{ENGINEER_ID}",
#   "description": "First week concrete...",
#   "mediaUrls": ["http://localhost:9000/..."],
#   "mediaType": "IMAGE",
#   "createdAt": "2024-08-22T..."
# }
```

### Test 3.4: List Updates

```bash
curl -X GET http://localhost:3000/api/projects/{PROJECT_ID}/updates \
  -H "Authorization: Bearer {ENGINEER_TOKEN}"

# Expected Response (200): Array of updates newest-first
# [
#   { "id": "...", "description": "First week concrete...", ... },
#   { "id": "...", "description": "Foundation excavation...", ... }
# ]
```

**Expected Result:** ✅ S3 presigning and update recording working

---

## 📦 Phase 4: Material Management Testing

### Test 4.1: Create Material Entry (RECEIVED)

```bash
curl -X POST http://localhost:3000/api/projects/{PROJECT_ID}/materials \
  -H "Authorization: Bearer {ENGINEER_TOKEN}" \
  -H "Content-Type: application/json" \
  -d {
    "name": "Steel Reinforcement",
    "category": "Structural Steel",
    "entryType": "RECEIVED",
    "quantity": 100,
    "unitCost": 50.00,
    "date": "2024-08-22T10:00:00Z"
  }

# Expected Response (201):
# {
#   "id": "material-uuid-123",
#   "name": "Steel Reinforcement",
#   "entryType": "RECEIVED",
#   "quantity": 100,
#   "unitCost": 50,
#   ...
# }
```

### Test 4.2: Create Material Entry (CONSUMED)

```bash
curl -X POST http://localhost:3000/api/projects/{PROJECT_ID}/materials \
  -H "Authorization: Bearer {ENGINEER_TOKEN}" \
  -H "Content-Type: application/json" \
  -d {
    "name": "Steel Reinforcement",
    "category": "Structural Steel",
    "entryType": "CONSUMED",
    "quantity": 60,
    "unitCost": 50.00,
    "date": "2024-08-22T14:00:00Z"
  }

# Expected Response (201): Entry recorded
```

### Test 4.3: List Material Entries

```bash
curl -X GET http://localhost:3000/api/projects/{PROJECT_ID}/materials \
  -H "Authorization: Bearer {ENGINEER_TOKEN}"

# Expected Response (200):
# [
#   { "entryType": "RECEIVED", "quantity": 100, ... },
#   { "entryType": "CONSUMED", "quantity": 60, ... }
# ]
```

### Test 4.4: Get Material Summary

```bash
curl -X GET http://localhost:3000/api/projects/{PROJECT_ID}/materials/summary \
  -H "Authorization: Bearer {ENGINEER_TOKEN}"

# Expected Response (200):
# {
#   "materials": [
#     {
#       "name": "Steel Reinforcement",
#       "totalReceived": 100,
#       "totalConsumed": 60,
#       "difference": 40,
#       "discrepancy": false
#     }
#   ]
# }
```

### Test 4.5: Create Discrepancy

```bash
# Add another consumed entry to trigger discrepancy
curl -X POST http://localhost:3000/api/projects/{PROJECT_ID}/materials \
  -H "Authorization: Bearer {ENGINEER_TOKEN}" \
  -H "Content-Type: application/json" \
  -d {
    "name": "Steel Reinforcement",
    "category": "Structural Steel",
    "entryType": "CONSUMED",
    "quantity": 50,
    "unitCost": 50.00,
    "date": "2024-08-22T15:00:00Z"
  }

# Now get summary again
curl -X GET http://localhost:3000/api/projects/{PROJECT_ID}/materials/summary \
  -H "Authorization: Bearer {ENGINEER_TOKEN}"

# Expected: discrepancy = true (consumed 110 > received 100)
```

**Expected Result:** ✅ Material tracking with automatic discrepancy detection working

---

## 💬 Phase 5: Real-Time Chat Testing

### Test 5.1: Get Chat History

```bash
curl -X GET http://localhost:3000/api/projects/{PROJECT_ID}/chat/history \
  -H "Authorization: Bearer {ENGINEER_TOKEN}"

# Expected Response (200): Empty array or existing messages
# []
```

### Test 5.2: Connect WebSocket (Postman or Browser Console)

Open browser Developer Tools (F12) and run:

```javascript
// In browser console
const socket = io('http://localhost:3000', {
  auth: {
    token: '{YOUR_ENGINEER_TOKEN}'
  }
});

socket.on('connect', () => {
  console.log('✅ Socket connected:', socket.id);
});

socket.on('connect_error', (error) => {
  console.error('❌ Connection error:', error);
});

// Join project room
socket.emit('project:join', { projectId: '{PROJECT_ID}' });

// Listen for messages
socket.on('chat:message', (message) => {
  console.log('📨 New message:', message);
});
```

**Expected Output:**
```
✅ Socket connected: abc123xyz
📨 New message: { projectId: "...", senderId: "...", content: "...", createdAt: "..." }
```

### Test 5.3: Send Chat Message (WebSocket)

```javascript
socket.emit('chat:send', {
  projectId: '{PROJECT_ID}',
  content: 'Foundation concrete pour completed successfully!'
});
```

**Expected Output in Console:**
```
📨 New message: {
  id: "msg-uuid-123",
  projectId: "...",
  senderId: "...",
  content: "Foundation concrete pour completed successfully!",
  fileUrl: null,
  createdAt: "2024-08-22T..."
}
```

### Test 5.4: Send Message with Attachment

```javascript
socket.emit('chat:send', {
  projectId: '{PROJECT_ID}',
  content: 'Check the concrete cure report',
  fileUrl: 'http://localhost:9000/buildsite360/cure-report.pdf'
});
```

**Expected Result:** ✅ Real-time chat with file attachments working

---

## 📹 Phase 6: Camera Streaming Testing

### Test 6.1: Register Camera

```bash
curl -X POST http://localhost:3000/api/projects/{PROJECT_ID}/cameras \
  -H "Authorization: Bearer {ENGINEER_TOKEN}" \
  -H "Content-Type: application/json" \
  -d {
    "name": "Site Entrance Gate",
    "zone": "ENTRANCE",
    "rtspUrl": "rtsp://127.0.0.1:8554/testcam"
  }

# Expected Response (201):
# {
#   "id": "camera-uuid-123",
#   "name": "Site Entrance Gate",
#   "zone": "ENTRANCE",
#   "rtspUrl": "rtsp://127.0.0.1:8554/testcam",
#   "status": "OFFLINE",
#   ...
# }
```

**💾 Save the camera ID**

### Test 6.2: List Cameras

```bash
curl -X GET http://localhost:3000/api/projects/{PROJECT_ID}/cameras \
  -H "Authorization: Bearer {ENGINEER_TOKEN}"

# Expected Response (200):
# [
#   {
#     "id": "camera-uuid-123",
#     "name": "Site Entrance Gate",
#     "zone": "ENTRANCE",
#     "status": "OFFLINE",
#     ...
#   }
# ]
```

### Test 6.3: Stream Camera (Setup MediaMTX First)

**Setup RTSP Server (Terminal 5):**

```bash
# Download MediaMTX from https://github.com/bluenviron/mediamtx/releases
# (Windows: mediamtx.exe)

# Terminal 5 - Start MediaMTX server
mediamtx.exe

# Terminal 6 - Publish test stream
ffmpeg -re -stream_loop -1 -f lavfi -i "testsrc=size=640x480:rate=15" \
  -c:v libx264 -preset ultrafast -tune zerolatency -pix_fmt yuv420p -g 30 \
  -f rtsp -rtsp_transport tcp rtsp://127.0.0.1:8554/testcam

# Expected: MediaMTX shows "rtsp://127.0.0.1:8554/testcam is ready"
```

### Test 6.4: View MJPEG Stream (Browser)

```bash
# Open in browser:
http://localhost:3000/api/cameras/{CAMERA_ID}/stream

# Expected: Live stream of test pattern (colored bars moving)
# If camera is offline: Error message instead of hanging
```

### Test 6.5: Record Clip

```bash
curl -X POST http://localhost:3000/api/cameras/{CAMERA_ID}/record-clip \
  -H "Authorization: Bearer {ENGINEER_TOKEN}"

# Expected Response (202 - Accepted):
# {
#   "message": "Recording started",
#   "clipUrl": "http://localhost:9000/buildsite360/clip-20240822-123456.mp4"
# }
# (Check after 30 seconds for the file to be ready)

# Verify clip exists
curl -X HEAD http://localhost:9000/buildsite360/clip-20240822-123456.mp4
# Expected: 200 OK
```

**Expected Result:** ✅ Camera streaming and clip recording working

---

## 🚨 Phase 8: Safety Detection Testing

### Test 8.1: Python Service Running

Verify the AI service is running:

```bash
curl http://localhost:8000/health
# Expected: {"status": "ok"}
```

### Test 8.2: Safety Alert Endpoint (Internal)

```bash
curl -X POST http://localhost:3000/api/internal/safety-alert \
  -H "X-Internal-Token: {INTERNAL_SERVICE_TOKEN}" \
  -H "Content-Type: application/json" \
  -d {
    "cameraId": "{CAMERA_ID}",
    "violationType": "NO_HELMET",
    "confidence": 0.95,
    "frameImageBase64": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABg..."
  }

# Expected Response (201):
# {
#   "id": "alert-uuid-123",
#   "projectId": "{PROJECT_ID}",
#   "cameraId": "{CAMERA_ID}",
#   "violationType": "NO_HELMET",
#   "confidenceScore": 0.95,
#   "frameImageUrl": "http://localhost:9000/buildsite360/...",
#   ...
# }
```

### Test 8.3: List Safety Alerts

```bash
curl -X GET http://localhost:3000/api/projects/{PROJECT_ID}/safety-alerts \
  -H "Authorization: Bearer {ENGINEER_TOKEN}"

# Expected Response (200):
# [
#   {
#     "id": "alert-uuid-123",
#     "violationType": "NO_HELMET",
#     "confidenceScore": 0.95,
#     "frameImageUrl": "http://localhost:9000/...",
#     "createdAt": "2024-08-22T..."
#   }
# ]
```

### Test 8.4: Real-Time Alert (WebSocket)

```javascript
// Continue from chat socket connection
socket.on('safety:alert', (alert) => {
  console.log('🚨 Safety Violation Detected:', alert);
});
```

**Expected Result:** ✅ Safety detection alerts working (needs AI service running)

---

## 👥 Phase 9: Attendance Tracking Testing

### Test 9.1: Enroll Worker

```bash
# First, get worker photos (use test images or placeholder)
# For testing, we can use base64 encoded images

curl -X POST http://localhost:3000/api/projects/{PROJECT_ID}/workers/enroll \
  -H "Authorization: Bearer {ENGINEER_TOKEN}" \
  -H "Content-Type: application/json" \
  -d {
    "name": "John Smith",
    "employeeId": "EMP-001",
    "photos": [
      "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABg...",
      "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABg..."
    ]
  }

# Expected Response (201):
# {
#   "id": "worker-uuid-123",
#   "name": "John Smith",
#   "employeeId": "EMP-001",
#   "projectId": "{PROJECT_ID}",
#   "enrolledAt": "2024-08-22T..."
# }
```

**💾 Save the worker ID**

### Test 9.2: Check Attendance (Daily)

```bash
curl -X GET "http://localhost:3000/api/projects/{PROJECT_ID}/attendance?range=daily" \
  -H "Authorization: Bearer {ENGINEER_TOKEN}"

# Expected Response (200):
# {
#   "date": "2024-08-22",
#   "totalCheckIns": 1,
#   "uniqueWorkers": 1,
#   "attendanceByWorker": [
#     {
#       "workerId": "worker-uuid-123",
#       "workerName": "John Smith",
#       "checkInTime": "2024-08-22T09:30:00Z",
#       "matchConfidence": 0.92
#     }
#   ]
# }
```

### Test 9.3: Check Attendance (Weekly)

```bash
curl -X GET "http://localhost:3000/api/projects/{PROJECT_ID}/attendance?range=weekly" \
  -H "Authorization: Bearer {ENGINEER_TOKEN}"

# Expected Response (200): Last 7 days aggregated
```

### Test 9.4: Real-Time Attendance (WebSocket)

```javascript
socket.on('attendance:checkin', (record) => {
  console.log('✅ Worker Checked In:', record);
  // { workerId: "...", workerName: "John Smith", confidence: 0.92, ... }
});
```

**Expected Result:** ✅ Attendance tracking working (needs AI service and camera setup)

---

## 📊 Phase 10: Reporting & Analytics Testing

### Test 10.1: Get Analytics Summary

```bash
curl -X GET http://localhost:3000/api/projects/{PROJECT_ID}/analytics \
  -H "Authorization: Bearer {ENGINEER_TOKEN}"

# Expected Response (200):
# {
#   "projectName": "Downtown Mall Renovation",
#   "dateRange": { "startDate": "2024-08-01", "endDate": "2024-08-22" },
#   "siteUpdates": {
#     "totalUpdates": 2,
#     "lastUpdateDate": "2024-08-22T..."
#   },
#   "attendance": {
#     "totalCheckIns": 1,
#     "uniqueWorkers": 1,
#     "averageCheckInTime": "09:30:00"
#   },
#   "safetyAlerts": {
#     "totalAlerts": 1,
#     "byType": { "NO_HELMET": 1, "NO_VEST": 0 },
#     "byCameraZone": { "ENTRANCE": 1 }
#   },
#   "materials": {
#     "totalReceived": 100,
#     "totalConsumed": 110,
#     "discrepancies": 1
#   }
# }
```

### Test 10.2: Generate Report (Manual)

```bash
curl -X POST http://localhost:3000/api/projects/{PROJECT_ID}/reports/generate-now \
  -H "Authorization: Bearer {ADMIN_TOKEN}"

# Expected Response (202 - Accepted):
# {
#   "message": "Report generation started",
#   "reportId": "report-uuid-123"
# }

# Wait 5-10 seconds for PDF to be generated...

# Check status
curl -X GET http://localhost:3000/api/projects/{PROJECT_ID}/reports \
  -H "Authorization: Bearer {ADMIN_TOKEN}"

# Expected:
# [
#   {
#     "id": "report-uuid-123",
#     "reportType": "DAILY",
#     "pdfUrl": "http://localhost:9000/buildsite360/report-20240822.pdf",
#     "generatedAt": "2024-08-22T..."
#   }
# ]
```

### Test 10.3: Download Report

```bash
# Download the PDF
curl -X GET "http://localhost:9000/buildsite360/report-20240822.pdf" \
  -o report-download.pdf

# Verify it's a valid PDF
file report-download.pdf
# Expected: PDF document, version 1.4
```

**Expected Result:** ✅ Report generation and analytics working

---

## 💳 Phase 11: Billing Testing

### Test 11.1: Get Current Subscription

```bash
curl -X GET http://localhost:3000/api/billing/subscription \
  -H "Authorization: Bearer {ADMIN_TOKEN}"

# Expected Response (200):
# {
#   "plan": "BASIC",
#   "status": "ACTIVE",
#   "provider": "EASYPAISA",
#   "startDate": "2024-08-22T...",
#   "nextBillingDate": "2024-09-22T..."
# }
```

### Test 11.2: Initiate Checkout

```bash
curl -X POST http://localhost:3000/api/billing/checkout \
  -H "Authorization: Bearer {ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d {
    "plan": "PRO",
    "provider": "EASYPAISA"
  }

# Expected Response (201):
# {
#   "sessionUrl": "https://easypaisa.sandbox.test/checkout/...",
#   "provider": "EASYPAISA"
# }
```

### Test 11.3: Simulate Webhook (EasyPaisa)

```bash
curl -X POST http://localhost:3000/api/billing/webhook/easypaisa \
  -H "Content-Type: application/json" \
  -d {
    "transactionId": "EZP-123456789",
    "status": "SUCCESS",
    "amount": 9999,
    "timestamp": "2024-08-22T10:00:00Z",
    "signature": "valid-sandbox-signature"
  }

# Expected Response (200):
# { "message": "Webhook processed successfully" }
```

**Expected Result:** ✅ Billing system working in sandbox mode

---

## 🧪 Phase 12: Complete Integration Testing

### Test 12.1: Run Full Postman Collection

Open Postman and import `server/postman_collection.json`:

```bash
# Or run from CLI:
cd server
npm install -g newman

newman run postman_collection.json \
  --environment server/tests/newman-env.json \
  --globals server/tests/newman-globals.json

# Expected Output:
# Newman
# 
# Admin Token Test
#   ✔ Admin Login
#   ✔ Create Project
#   ✔ Assign Engineer
#   ✔ List Projects
# 
# Engineer Token Tests
#   ✔ Engineer Login
#   ✔ Engineer List Projects
#   ✔ Create Site Update
#   ✔ Create Material Entry
# 
# Client Token Tests
#   ✔ Client Login
#   ✔ Client List Projects
# 
# Negative Paths
#   ✔ Unauthorized Access (401)
#   ✔ Forbidden Access (403)
#   ✔ Not Found (404)
# 
# done – 17 tests passed (3.2s)
```

### Test 12.2: Run E2E Test Suite

```bash
cd server

# Run end-to-end tests
npm run test:e2e

# Or with Newman
newman run tests/e2e.postman_collection.json \
  --environment tests/newman-env.json \
  -r cli

# Expected: All tests pass
```

**Expected Result:** ✅ All 40+ endpoints tested and working

---

## 🎨 Phase 13: UI/UX Testing (Browser)

### Test 13.1: Authentication Flows

Open http://localhost:5173

```
1. Click "Register" → Fill form → Submit
   ✓ Should show success message
   
2. Click "Login" → Use (admin@test.com / password123)
   ✓ Should redirect to dashboard
   ✓ Show "Connected" status
   
3. Click "Logout"
   ✓ Should redirect to login page
```

### Test 13.2: Project Management

```
1. Dashboard shows all projects you have access to
   ✓ Table displays correctly
   ✓ Status badges show colors
   
2. Click on project → View details
   ✓ Tabs visible: Updates, Materials, Chat, Alerts
   ✓ Project info displays correctly
   
3. (Admin only) Create new project
   ✓ Form validates input
   ✓ Shows success message
   ✓ New project appears in list
```

### Test 13.3: Real-Time Chat

```
1. Go to project → Chat tab
2. Type message → Press Send
   ✓ Message appears immediately in your view
   ✓ Timestamp shows
   
3. Open same project in another browser tab/window
   ✓ Message from step 2 appears in real-time
   ✓ Both windows stay in sync
   
4. Try file attachment
   ✓ File URL input works
   ✓ Message displays with file link
```

### Test 13.4: Live Camera Monitoring

```
1. Go to Live Monitoring page
2. See registered cameras
   ✓ Camera name displays
   ✓ Status shows ONLINE or OFFLINE
   
3. Click camera
   ✓ Should show MJPEG stream (if available)
   ✓ Or error message if offline
   
4. Click "Record 30s Clip"
   ✓ Should show status
   ✓ When done, show link to S3 video file
```

### Test 13.5: Material Management

```
1. Go to Materials panel
2. Add RECEIVED entry
   ✓ Form submits
   ✓ Entry appears in list
   
3. Add CONSUMED entry (more than received)
   ✓ Entry submitted
   
4. View summary
   ✓ Shows totalReceived, totalConsumed
   ✓ Shows DISCREPANCY label in red
```

### Test 13.6: Safety & Attendance

```
1. Go to Safety Alerts
   ✓ Shows historical alerts with images
   ✓ Lists violation type and confidence
   
2. Go to Attendance
   ✓ Shows worker enrollment form
   ✓ Shows attendance table
   ✓ Can switch between daily/weekly/monthly
```

### Test 13.7: Analytics & Reports

```
1. Go to Analytics Dashboard
   ✓ Charts render (bar/line charts with Recharts)
   ✓ Data displays correctly
   
2. Go to Reports page
   ✓ Lists generated reports
   ✓ Can download PDF
   
3. Click "Generate Report Now" (Admin)
   ✓ Shows processing message
   ✓ After 10s, new report appears in list
```

### Test 13.8: Billing (Admin Only)

```
1. Go to Billing page
2. See three plans
   ✓ Displays BASIC, PRO, ENTERPRISE
   ✓ Shows prices and features
   
3. Click "Subscribe" to PRO
   ✓ Redirects to payment sandbox
   
4. View subscription status
   ✓ Shows current plan
   ✓ Shows next billing date
```

**Expected Result:** ✅ All UI pages render and function correctly

---

## 📋 Complete Testing Checklist

Run through this comprehensive checklist to verify all features:

### ✅ Authentication & Authorization
- [ ] Register new user
- [ ] Login with correct credentials
- [ ] Login fails with wrong password (401)
- [ ] Access protected route without token (401)
- [ ] Access route with wrong role (403)
- [ ] Token refresh works
- [ ] Logout clears token

### ✅ Project Management
- [ ] Create project (ADMIN only)
- [ ] List shows only accessible projects based on role
- [ ] ADMIN sees all projects
- [ ] ENGINEER sees only assigned projects
- [ ] CLIENT sees only owned projects
- [ ] View project details
- [ ] Update project (ADMIN only)
- [ ] Assign engineer to project
- [ ] Delete project (ADMIN only)

### ✅ Site Updates & Media
- [ ] Get presigned S3 URL
- [ ] Upload file to S3
- [ ] Save update record with S3 URLs
- [ ] List updates in reverse-chronological order
- [ ] Can attach images and videos

### ✅ Material Management
- [ ] Create RECEIVED entry
- [ ] Create CONSUMED entry
- [ ] View material list
- [ ] Get summary (aggregated by database)
- [ ] Discrepancy flag shows when consumed > received
- [ ] Can filter by date/category

### ✅ Real-Time Communication
- [ ] WebSocket connects with JWT auth
- [ ] Can join project room
- [ ] Send message - appears immediately
- [ ] Receive broadcasts from other users
- [ ] Chat history loads on page refresh
- [ ] Can attach files to messages

### ✅ Camera Streaming
- [ ] Register camera with RTSP URL
- [ ] List cameras with status
- [ ] Camera shows ONLINE after connection
- [ ] MJPEG stream displays in browser
- [ ] Record 30-second clip
- [ ] Clip saves to S3 with URL

### ✅ Safety Detection
- [ ] Safety detector service running
- [ ] Violations create alerts
- [ ] Alerts have confidence scores
- [ ] Real-time socket notifications
- [ ] Can view alert history with frame images
- [ ] Cooldown prevents alert spam

### ✅ Attendance
- [ ] Enroll worker with photos
- [ ] Face embedding generated
- [ ] Automatic check-in on face recognition
- [ ] View daily attendance
- [ ] View weekly/monthly aggregated attendance
- [ ] No duplicate check-ins per day

### ✅ Analytics & Reporting
- [ ] Get project summary (all metrics)
- [ ] Charts display correctly
- [ ] Generate daily report
- [ ] Generate weekly report
- [ ] Reports download as valid PDFs
- [ ] Email sent to client on report creation

### ✅ Billing
- [ ] View subscription status
- [ ] Initiate checkout for plan upgrade
- [ ] Webhook receives payment confirmation
- [ ] Subscription activated on payment
- [ ] Plan limits enforced (can't create extra projects)

### ✅ UI/UX
- [ ] All pages load without errors
- [ ] Responsive design works on tablet
- [ ] Design system colors consistent
- [ ] Buttons and form inputs styled properly
- [ ] Accessibility: focus states visible
- [ ] Error messages clear and helpful
- [ ] Loading states show during async operations
- [ ] Empty states when no data

### ✅ Infrastructure
- [ ] Database migrations applied
- [ ] All environment variables set
- [ ] S3/MinIO storage configured
- [ ] Email service working (check logs)
- [ ] Cron jobs execute on schedule
- [ ] FFmpeg processes streams without crashing
- [ ] No hardcoded URLs in code

---

## 🐛 Troubleshooting Common Issues

### Issue: "Cannot find module"
```bash
# Solution:
cd [service]
npm install
# or
pip install -r requirements.txt
```

### Issue: Database connection fails
```bash
# Verify PostgreSQL is running
# Check DATABASE_URL in .env
# Test connection:
psql $DATABASE_URL -c "SELECT 1"
```

### Issue: MinIO/S3 errors
```bash
# Create bucket if missing
mc mb minio/buildsite360
# or via web UI: http://localhost:9001
```

### Issue: FFmpeg not found
```bash
# Install ffmpeg:
# Windows: choco install ffmpeg
# Add to PATH or set FFMPEG_PATH in .env
```

### Issue: WebSocket connection refused
```bash
# Check CORS in server/src/index.js
# Should allow http://localhost:5173
# Restart server after changes
```

### Issue: AI Service doesn't start
```bash
# Check Python version: python --version (should be 3.10 or 3.11)
# Check venv is activated
# Check requirements installed: pip list
```

### Issue: Images not loading in browser
```bash
# Check S3/MinIO is running
# Verify presigned URLs are correct
# Check CORS on MinIO: http://localhost:9001/admin
```

---

## ✨ Final Verification Summary

When all tests pass, you should see:

| Component | Status | Evidence |
|-----------|--------|----------|
| API Health | ✅ | GET /api/health returns 200 |
| Database | ✅ | 14 tables created, data persists |
| S3/MinIO | ✅ | Files upload and download |
| WebSocket | ✅ | Chat messages real-time |
| Camera Stream | ✅ | MJPEG visible in browser |
| AI Services | ✅ | Alerts and attendance working |
| React UI | ✅ | All pages load, no console errors |
| Email | ✅ | Reports sent to client |
| Billing | ✅ | Subscription status tracks |
| Security | ✅ | Role-based access enforced |

**Total Features Tested: 162** ✅

---

## 📝 Reporting Issues

If you find any issues during testing, create a bug report with:

1. **Component:** (API, Database, UI, WebSocket, etc.)
2. **Feature:** (Which phase/feature)
3. **Steps to Reproduce:** Exact curl commands or browser actions
4. **Expected Result:** What should happen
5. **Actual Result:** What actually happened
6. **Error Messages:** Full console/server logs
7. **Environment:** Windows/Mac, Node/Python versions, etc.

Example:
```
Component: Chat WebSocket
Feature: Real-Time Messages (Phase 5)

Steps:
1. Open http://localhost:5173
2. Login as engineer@test.com
3. Go to project details
4. Send message "test"

Expected: Message appears immediately in chat panel
Actual: Message appears after 5+ second delay

Error: Console shows "WebSocket latency: 5234ms"
```

---

## 🎉 Success Criteria

Your local testing is successful when:

✅ All 4 services start without errors
✅ All 13 phases have working features
✅ All Postman collections pass
✅ All UI pages load and function
✅ Real-time chat and notifications work
✅ File uploads to S3 succeed
✅ Database queries return expected results
✅ Security (auth/roles) enforced
✅ No console errors in browser
✅ No error logs in server terminal

**Expected Total Test Time:** 2-3 hours for complete coverage

