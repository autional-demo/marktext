"use client";

import { useParams } from "next/navigation";
import AppGate from "@/components/app-gate";

export default function DocPage() {
  const params = useParams<{ id: string | string[] }>();
  const raw = params?.id;
  const id = Array.isArray(raw) ? raw[0] : raw;
  return <AppGate initialDocId={id} />;
}
