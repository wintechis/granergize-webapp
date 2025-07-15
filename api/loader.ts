import { Parser } from "n3";
import type { Quad } from "@rdfjs/types";

const parser = new Parser();

export async function loadTtl(url: string | null, localPath: string): Promise<Array<Quad>> {
  // If no URL provided, load directly from local file
  if (url === null) {
    try {
      const graphString = await Deno.readTextFile(localPath);
      console.log(`Loaded data from local file: ${localPath}`);
      return parseQuads(graphString);
    } catch (localError) {
      console.error(`Failed to read local file ${localPath}: ${localError}`);
      throw new Error(`Failed to load data from ${localPath}.`);
    }
  }

  // If URL provided: Try URL first, then fallback to local
  try {
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const graphString = await response.text();
    return parseQuads(graphString);
  } catch (error: unknown) {
    console.error(`Failed to fetch from ${url}: ${error}`);
    // Fallback to local file
    try {
      const graphString = await Deno.readTextFile(localPath);
      console.warn(`Loaded data from local file: ${localPath}`);
      return parseQuads(graphString);
    } catch (localError) {
      console.error(`Failed to read local file ${localPath}: ${localError}`);
      throw new Error(`Failed to load data from both ${url} and ${localPath}.`);
    }
  }
}

function parseQuads(graphString: string): Promise<Array<Quad>> {
  return new Promise((resolve, reject) => {
    const quads: Array<Quad> = [];
    parser.parse(graphString, (error: unknown, quad: Quad) => {
      if (error) reject(error);
      if (quad) quads.push(quad);
      else resolve(quads);
    });
  });
}