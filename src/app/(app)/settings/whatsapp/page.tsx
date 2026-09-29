import { PERMISSIONS } from "@/lib/rbac";
import { requireFirmId, requirePermission } from "@/lib/session";
import { getWhatsAppStatus, getWhatsAppTemplates } from "@/lib/services/whatsapp";
import { WhatsAppSettingsView } from "./whatsapp-settings-view";

export const metadata = { title: "WhatsApp Gateway Settings" };

export default async function WhatsAppSettingsPage() {
  const user = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
  const firmId = requireFirmId(user);

  const [statusData, templates] = await Promise.all([
    getWhatsAppStatus(firmId, { forceRefresh: true }),
    getWhatsAppTemplates(firmId),
  ]);

  return <WhatsAppSettingsView initialStatusData={statusData} templates={templates} />;
}
