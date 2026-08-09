from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import os
from dotenv import load_dotenv

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health_check():
    return {"status": "ok"}


# Face enrolment. Mounted defensively: the module imports numpy and (lazily)
# deepface, and a failure there must not take down the health check that the
# rest of the stack depends on.
try:
    from endpoints.enrollment import router as enrollment_router

    app.include_router(enrollment_router)
except Exception as exc:  # pragma: no cover
    print(f"WARNING: /enroll unavailable: {exc}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
