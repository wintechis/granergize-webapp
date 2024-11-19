import { Parser } from "n3";
import type { Quad } from "@rdfjs/types";

const parser = new Parser();

export async function loadTTLFile(url: string): Promise<Array<Quad>> {
  try {
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const graphString = await response.text();
    const quads: Array<Quad> = [];
    
    return new Promise((resolve, reject) => {
      parser.parse(graphString, (error: Error, quad: Quad, prefixes: any) => {
        if (error) reject(error);
        if (quad) quads.push(quad);
        else resolve(quads);
      });
    });
  } catch (error: unknown) {
    if (error instanceof Error) {
      throw new Error(`Failed to load TTL file from ${url}: ${error.message}`);
    }
    throw new Error(`Failed to load TTL file from ${url}: Unknown error`);
  }
}