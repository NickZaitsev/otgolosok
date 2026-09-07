import type { Metadata } from "next";
import { AdminDesk } from "@/features/admin/admin-desk";
import "@/features/admin/admin.css";

export const metadata: Metadata = {
  title: "Редакция | Отголосок",
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return <AdminDesk />;
}
