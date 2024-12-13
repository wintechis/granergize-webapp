import { Application, Router } from "@oak/oak";
import { oakCors } from "@tajpouria/cors";
import { parseEnergyMeasurements, parseEnergyMix } from "./utils/parser.ts";
import routeStaticFilesFrom from "./utils/routeStaticFilesFrom.ts";

const app = new Application();
const router = new Router();
// Initialize data
const data = await parseEnergyMeasurements();
const { agents, buildings, energyNeed, averages, agentAverages } = data;

const energyMix = await parseEnergyMix();

router.get("/api/buildings", (context) => {
  context.response.body = buildings;
});

router.get("/api/buildings/:building", (context) => {
  if (!context?.params?.building) {
    context.response.status = 400;
    context.response.body = { error: "No building id provided" };
    return;
  }

  const building = buildings.find((item) =>
    item.id === parseInt(context.params.building)
  );

  if (!building) {
    context.response.status = 404;
    context.response.body = { error: "Building not found" };
    return;
  }

  context.response.body = building;
});

router.get("/api/agents", (context) => {
  context.response.body = agents;
});

router.get("/api/agents/:agent", (context) => {
  if (!context?.params?.agent) {
    context.response.status = 400;
    context.response.body = { error: "No agent id provided" };
    return;
  }

  const agent = agents.find((item) => item.id === context.params.agent);

  if (!agent) {
    context.response.status = 404;
    context.response.body = { error: "Agent not found" };
    return;
  }

  context.response.body = agent;
});

router.get("/api/energy/:building", (context) => {
  if (!context?.params?.building) {
    context.response.body = "No building id provided.";
    return
  }

  if (!energyNeed) {
    context.response.body = "No energy data available.";
    return;
  }

  const energy = energyNeed.find((item) =>
    item.id === parseInt(context.params.building)
  );

  context.response.body = energy;
});

router.get("/api/energy-averages", (context) => {
  context.response.body = {averages, agentAverages};
});

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