# BuildSite 360 - Project Overview

**Project:** Construction Site Monitoring Platform for FYP  
**Status:** 93% Complete (13/14 phases fully implemented)  
**Last Updated:** August 22, 2026

---

## Project Summary

BuildSite 360 is a comprehensive full-stack construction site monitoring platform designed to ease the workload of construction companies. The application provides real-time monitoring, safety detection, material tracking, team attendance, and analytics capabilities.

### Core Features Implemented

✅ **User Authentication & Authorization** - Role-based access control (ADMIN/ENGINEER/CLIENT)  
✅ **Project Management** - Multi-project support with team assignment  
✅ **Site Monitoring** - Manual daily updates with media uploads  
✅ **Material Management** - Track materials received/consumed with discrepancy detection  
✅ **Real-Time Communication** - WebSocket-based chat system  
✅ **Live Camera Streaming** - MJPEG streaming with clip recording  
✅ **Safety Detection** - AI-powered PPE (helmet/vest) detection  
✅ **Attendance Tracking** - Facial recognition-based worker check-in  
✅ **Analytics & Reporting** - Automated daily/weekly PDF reports  
✅ **Payment Gateway** - Subscription billing with multiple providers  
✅ **End-to-End Testing** - Comprehensive test coverage and automation  
✅ **UI/UX Design System** - Consistent component library and styling

---

## Tech Stack

### Frontend
- **Framework:** React 18 + Vite
- **HTTP Client:** Axios with JWT interceptors
- **Real-Time:** Socket.io
- **Charts:** Recharts
- **Styling:** CSS with design tokens and component library
- **State Management:** React Context (AuthContext)

### Backend
- **Runtime:** Node.js 20
- **Framework:** Express.js 4
- **Database:** PostgreSQL 15 (Prisma ORM)
- **Real-Time:** Socket.io
- **File Storage:** AWS S3 / MinIO
- **Authentication:** JWT (Access + Refresh tokens)
- **Email:** Nodemailer
- **PDF Generation:** pdfkit
- **Task Scheduling:** node-cron
- **Video Processing:** ffmpeg

### AI/ML Service
- **Language:** Python 3.10
- **Web Framework:** FastAPI
- **Safety Detection:** YOLOv8s (Ultralytics)
- **Facial Recognition:** DeepFace + ArcFace
- **Computer Vision:** OpenCV
- **Deep Learning:** PyTorch

---

## Project Structure

```
FYP/
├── client/                    # React frontend application
│   ├── src/
│   │   ├── components/        # Reusable UI components and panels
│   │   ├── pages/            # Application pages
│   │   ├── context/          # React context (auth, state)
│   │   ├── api/              # API configuration and socket setup
│   │   ├── styles/           # Design system and tokens
│   │   └── App.jsx           # Main application component
│   └── vite.config.js        # Vite configuration
│
├── server/                    # Node.js/Express backend API
│   ├── src/
│   │   ├── routes/           # API endpoints organized by feature
│   │   ├── services/         # Business logic (reports, email, etc)
│   │   ├── middleware/       # Auth, subscriptions, CORS
│   │   ├── sockets/          # WebSocket event handlers
│   │   ├── jobs/             # Cron jobs (report generation)
│   │   ├── utils/            # Utilities (S3, Prisma, auth)
│   │   ├── config/           # Configuration
│   │   └── index.js          # Server entry point
│   ├── prisma/
│   │   ├── schema.prisma     # Database schema
│   │   └── migrations/       # Database migrations
│   ├── tests/                # E2E tests and test data
│   ├── scripts/              # Seeding and utility scripts
│   └── package.json
│
├── ai-service/               # Python FastAPI AI microservice
│   ├── services/             # ML models and inference logic
│   ├── scripts/              # Standalone training/testing scripts
│   ├── endpoints/            # FastAPI endpoints
│   ├── notebooks/            # Jupyter notebooks for model training
│   ├── data/                 # Training data and outputs
│   ├── main.py              # FastAPI application entry point
│   ├── requirements.txt      # Python dependencies
│   └── TRAINING.md           # Model training documentation
│
└── README.md                 # Root project setup guide
```

---

## Database Schema

The Prisma schema includes 14 models supporting all features:

- **User** - Users with roles (ADMIN, ENGINEER, CLIENT)
- **Project** - Construction projects with location and status
- **ProjectEngineer** - Many-to-many assignment of engineers to projects
- **SiteUpdate** - Daily updates with media (images/videos)
- **MaterialEntry** - Material tracking (received/consumed)
- **Camera** - Project cameras with RTSP streams
- **SafetyAlert** - PPE violation detections with confidence scores
- **ChatMessage** - Real-time project communication
- **Worker** - Workers with enrolled face embeddings
- **AttendanceRecord** - Daily check-in records with match confidence
- **Subscription** - Billing plans and subscription status
- **Report** - Generated PDF reports (daily/weekly)
- **HealthCheck** - Connection verification model

---

## API Endpoints Summary

### Authentication (POST)
- `/api/auth/register` - User registration
- `/api/auth/login` - User login
- `/api/auth/refresh` - Refresh access token
- `/api/auth/logout` - Logout
- `GET /api/auth/me` - Current user profile

### Projects (GET, POST, PUT, DELETE)
- `/api/projects` - List/create projects (role-scoped)
- `/api/projects/:id` - Get/update/delete single project
- `/api/projects/:id/assign-engineer` - Assign engineer to project

### Site Updates (GET, POST)
- `/api/projects/:id/updates` - List updates
- `/api/projects/:id/updates/presign` - Get S3 presigned URL

### Materials (GET, POST)
- `/api/projects/:id/materials` - List/create material entries
- `/api/projects/:id/materials/summary` - Aggregate summary with discrepancies

### Chat (GET, Socket.io events)
- `GET /api/projects/:id/chat/history` - Load chat history
- `socket: chat:send` - Send real-time message
- `socket: chat:message` - Receive message broadcast

### Cameras (GET, POST)
- `/api/projects/:id/cameras` - List/create cameras
- `GET /api/cameras/:id/stream` - MJPEG video stream
- `POST /api/cameras/:id/record-clip` - Record 30-second clip

### Safety (GET, Internal POST)
- `GET /api/projects/:id/safety-alerts` - Alert history
- `POST /api/internal/safety-alert` - AI service → internal endpoint (X-Internal-Token auth)
- `socket: safety:alert` - Real-time alert broadcast

### Attendance (GET, POST, Internal POST)
- `POST /api/projects/:id/workers/enroll` - Enroll worker with photos
- `GET /api/projects/:id/attendance` - Attendance with date range filter
- `POST /api/internal/attendance-record` - AI service → internal endpoint
- `socket: attendance:checkin` - Real-time check-in broadcast

### Analytics & Reports (GET, POST)
- `GET /api/projects/:id/analytics` - Summary data for charts
- `POST /api/projects/:id/reports/generate-now` - Manual report generation
- `GET /api/projects/:id/reports` - Report list with download links

### Billing (GET, POST)
- `GET /api/billing/subscription` - Current subscription
- `POST /api/billing/checkout` - Initiate payment session
- `POST /api/billing/webhook/:provider` - Payment confirmation

---

## React Pages & Components

### Pages
- **LoginPage** - User authentication
- **RegisterPage** - New user registration
- **ProjectListPage** - All accessible projects (role-scoped view)
- **ProjectDetailPage** - Single project dashboard with tabs
- **LiveMonitoringPage** - Real-time camera grid
- **AnalyticsDashboard** - Charts and statistics
- **AttendancePage** - Worker enrollment and daily/weekly/monthly views
- **BillingPage** - Subscription plans and status
- **ReportsPage** - Generated report list and downloads
- **ComponentGallery** - UI component showcase

### Component Panels
- **ChatPanel** - Real-time messaging
- **MaterialsPanel** - Material entry form and summary table
- **SiteUpdatesPanel** - Update feed with media
- **SafetyAlertsPanel** - Real-time PPE violations

### UI Component Library
- Button, Input, Select, Card, Modal, Table, Badge, Toast
- Design tokens (colors, typography, spacing)
- Theme-aware CSS with light/dark support

---

## Current Deployment Status

⚠️ **Phase 14 - PARTIAL (In Progress)**

- ✅ Environment configuration examples provided (.env.example files)
- ✅ Docker/service startup documentation complete
- ⚠️ Production deployment URLs not yet established
- ⚠️ Not deployed to Vercel (React), Railway/similar (Node/Python)
- ⚠️ Production database (Supabase) not configured
- ⚠️ S3 credentials for production not set up
- ⚠️ Payment provider production keys not configured

### Next Steps for Deployment
1. Deploy React app to Vercel
2. Deploy Node.js API to Railway or similar platform
3. Deploy Python AI service alongside Node API
4. Configure production database and environment variables
5. Update CORS settings for production domain
6. Test all features against live deployment

---

## Testing & Quality Assurance

### Test Coverage
- ✅ Postman collection with 17+ endpoint tests
- ✅ Automated E2E test suite
- ✅ Comprehensive seed script for test data
- ✅ Manual test script covering all user flows
- ✅ Role-based access control validation tests
- ✅ Negative path testing (401, 403, 404)

### Known Limitations / Future Improvements
- AI services assume local GPU/CPU for inference (can be slow)
- RTSP camera setup requires manual configuration
- Mobile responsiveness partial (tablet minimum supported)
- Some pages desktop-only due to complex layouts
- Production load testing not yet performed

---

## Documentation Files

- **README.md** - Quick start and environment setup
- **server/README.md** - Backend setup and seeding instructions
- **ai-service/TRAINING.md** - ML model training and validation details
- **server/BILLING_SANDBOX.md** - Payment gateway sandbox credentials and testing
- **tests/manual-test-script.md** - Step-by-step user journey testing guide

