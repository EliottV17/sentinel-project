from fastapi import FastAPI

app = FastAPI(title="Sentinel API")

@app.get("/")
async def root():
    return {"message": "Sentinel API está en línea y vigilando"}