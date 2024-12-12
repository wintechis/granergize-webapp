import type { Quad } from "@rdfjs/types";
import type { AgentType } from "../../types/types.ts";

export function parseAgents(quads: Quad[]): Map<string, AgentType> {
  const agents = new Map<string, AgentType>();

  quads.forEach((quad: Quad) => {
    if (quad.predicate.value === "https://schema.org/name") {
      const id = quad.subject.value.split("#")[1];
      agents.set(id, {
        id,
        type: "https://w3id.org/rec#agent",
        name: quad.object.value,
      });
    }
  });

  return agents;
}