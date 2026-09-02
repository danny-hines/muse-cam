import { hasPersistentDatabase } from "@/lib/repository";
import { MemoryFleetRepository } from "./memory";
import { NeonFleetRepository } from "./neon";
import type { FleetRepository } from "./types";

let repository: FleetRepository | null = null;

export function getFleetRepository(): FleetRepository {
  if (!repository) {
    repository = hasPersistentDatabase() ? new NeonFleetRepository() : new MemoryFleetRepository();
  }
  return repository;
}

export type { FleetRepository } from "./types";
