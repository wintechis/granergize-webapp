import { Application, Router } from "@oak/oak";
import { oakCors } from "@tajpouria/cors";
import { parseEnergyMix } from "./utils/parser.ts";
import routeStaticFilesFrom from "./utils/routeStaticFilesFrom.ts";

const app = new Application();
const router = new Router();

// Initialize energy mix data
const energyMix = await parseEnergyMix();

console.log("Energy Mix Data Loaded:", JSON.stringify(energyMix));

router.get("/api/energy-mix", (context) => {
  context.response.body = energyMix;
});

// Apply CORS middleware
app.use(oakCors());

// Apply router middleware
app.use(router.routes());
app.use(router.allowedMethods());

// Serve static files
app.use(routeStaticFilesFrom(["./public", "./dist"]));

// Start server
const port = 8000;
console.log(`Backend running on http://localhost:${port}`);
await app.listen({ port });
