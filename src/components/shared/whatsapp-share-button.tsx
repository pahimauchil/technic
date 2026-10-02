"use client";

import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface WhatsAppShareButtonProps {
  documentId: string;
  documentType: "invoice" | "quotation" | "purchase-order" | "purchase-bill" | "purchase-return" | "receipt" | "expense";
  documentNumber: string;
  customerPhone?: string;
}

export function WhatsAppShareButton({ documentId, documentType, documentNumber, customerPhone }: WhatsAppShareButtonProps) {
  const handleShare = () => {
    const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
    const pdfUrl = `${baseUrl}/api/documents/${documentType}/${documentId}`;
    const message = `Please find attached ${documentType.replace("-", " ")} ${documentNumber} from Technic Technologies. View PDF: ${pdfUrl}`;
    const whatsappUrl = customerPhone
      ? `https://wa.me/${customerPhone.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(message)}`
      : `https://wa.me/?text=${encodeURIComponent(message)}`;
    
    window.open(whatsappUrl, "_blank");
  };

  return (
    <Button variant="outline" onClick={handleShare}>
      <MessageCircle className="mr-2 h-4 w-4" />
      WhatsApp
    </Button>
  );
}
