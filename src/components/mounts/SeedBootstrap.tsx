"use client";

import { useEffect } from "react";
import { seedDevData } from "@/lib/db/seed";

export function SeedBootstrap(): null {
  useEffect(() => {
    void seedDevData().catch((err) => {
      console.error("[SeedBootstrap] seedDevData failed", err);
    });
  }, []);
  return null;
}
