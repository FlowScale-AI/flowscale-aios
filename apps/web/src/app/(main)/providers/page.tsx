import { redirect } from "next/navigation";

export default function ProvidersPage() {
  redirect("/settings?tab=compute");
}
