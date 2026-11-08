"use client";

import { useEffect } from "react";
import { SKELETON_EVENT, type SkeletonDetail } from "@/lib/nav-events";

/** Mounted by every route skeleton: tells <NavProgress> the page is still streaming in. */
export function LoadingBeacon() {
  useEffect(() => {
    const send = (delta: SkeletonDetail["delta"]) => {
      window.dispatchEvent(new CustomEvent<SkeletonDetail>(SKELETON_EVENT, { detail: { delta } }));
    };
    send(1);
    return () => send(-1);
  }, []);
  return null;
}
