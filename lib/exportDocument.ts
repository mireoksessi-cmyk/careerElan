import jsPDF from "jspdf";
import { Document, Packer, Paragraph } from "docx";
import { saveAs } from "file-saver";

export async function exportDocx(
  text: string,
  fileName: string
) {
  const doc = new Document({
    sections: [
      {
        children: text.split("\n").map(
          (line) =>
            new Paragraph({
              text: line,
            })
        ),
      },
    ],
  });

  const blob = await Packer.toBlob(doc);

  saveAs(blob, `${fileName}.docx`);
}

export async function exportPdf(
  text: string,
  fileName: string
) {

  text = text
  .replace(/[‐-‒–—―－]/g, "-")
  .replace(/[•▪◦]/g, "-")
  .replace(/[“”]/g, '"')
  .replace(/[‘’]/g, "'")
  .replace(/\t/g, " ");
  
  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  pdf.setFont("helvetica");
  pdf.setFontSize(10);

  const lines = pdf.splitTextToSize(text, 180);

  let y = 15;

  for (const line of lines) {
    if (y > 280) {
      pdf.addPage();
      y = 15;
    }

    pdf.text(line, 15, y);
    y += 5;
  }

  pdf.save(`${fileName}.pdf`);
}