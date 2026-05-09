import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SpreadsheetFile,
  Workbook
} from "file:///C:/Users/Usuario/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const outputDir = path.join(projectRoot, "outputs");
const outputPath = path.join(
  outputDir,
  "plantilla-importacion-jovenes-generacion-de-gloria.xlsx"
);

await fs.mkdir(outputDir, { recursive: true });

const workbook = Workbook.create();
const instructions = workbook.worksheets.add("Instrucciones");
const template = workbook.worksheets.add("Jovenes");

instructions.showGridLines = false;
template.freezePanes.freezeRows(1);

instructions.getRange("A1:F1").merge();
instructions.getRange("A1").values = [["Plantilla de Importacion Masiva de Jovenes"]];
instructions.getRange("A1").format = {
  fill: "#101828",
  font: { bold: true, color: "#FFFFFF", size: 16 },
  horizontalAlignment: "Center",
  verticalAlignment: "Center"
};
instructions.getRange("A1").format.rowHeightPx = 34;

instructions.getRange("A3:B12").values = [
  ["Campo", "Descripcion"],
  ["nombre_completo", "Nombre completo del joven. Obligatorio."],
  ["cedula", "Documento de identidad. Obligatorio."],
  ["celular", "Telefono principal. Obligatorio."],
  ["fecha_de_nacimiento", "Fecha en formato AAAA-MM-DD. Obligatorio."],
  ["correo", "Correo electronico. Opcional."],
  ["bautizados", "Usa solo SI o NO. Obligatorio."],
  ["rol", "Miembro, Lider, Mentor o Diacono. Obligatorio."],
  ["estado", "Usa solo activo o inactivo. Obligatorio."],
  ["notas", "Observaciones pastorales o administrativas. Opcional."],
  ["id", "No incluir. El sistema lo genera automaticamente."]
];
instructions.getRange("A3:B3").format = {
  fill: "#84974A",
  font: { bold: true, color: "#FFFFFF" }
};
instructions.getRange("A3:B12").format.wrapText = true;
instructions.getRange("A3:A12").format.font = { bold: true };
instructions.getRange("A3:B12").format.borders = {
  top: { style: "Continuous", color: "#D0D5DD" },
  bottom: { style: "Continuous", color: "#D0D5DD" },
  left: { style: "Continuous", color: "#D0D5DD" },
  right: { style: "Continuous", color: "#D0D5DD" }
};

instructions.getRange("D3:F8").values = [
  ["Regla", "Valor esperado", "Notas"],
  ["Separador al exportar CSV", "Coma (,)", "Si trabajas en Excel, guarda como CSV UTF-8."],
  ["Encabezados", "Fila 1 obligatoria", "No cambies los nombres de columnas."],
  ["Filas vacias", "No incluir", "El importador ignora lineas en blanco."],
  ["Roles ministeriales", "Miembro/Lider/Mentor/Diacono", "Co-Lider se normaliza a Lider."],
  ["Columnas extra", "No necesarias", "No incluyas ID ni claves tecnicas."]
];
instructions.getRange("D3:F3").format = {
  fill: "#1D2939",
  font: { bold: true, color: "#FFFFFF" }
};
instructions.getRange("D3:F8").format.wrapText = true;
instructions.getRange("D3:F8").format.borders = {
  top: { style: "Continuous", color: "#D0D5DD" },
  bottom: { style: "Continuous", color: "#D0D5DD" },
  left: { style: "Continuous", color: "#D0D5DD" },
  right: { style: "Continuous", color: "#D0D5DD" }
};

instructions.getRange("A13:F16").merge(true);
instructions.getRange("A13").values = [[
  "Proceso sugerido: diligencia la hoja Jovenes, guarda una copia en Excel para control interno y luego exporta esa hoja a CSV UTF-8 para pegarla o cargarla en el flujo de importacion del CRM."
]];
instructions.getRange("A13:F16").format = {
  fill: "#F2F4F7",
  font: { color: "#344054" },
  wrapText: true
};

instructions.getRange("A1:F16").format.columnWidthPx = 180;
instructions.getRange("A:A").format.columnWidthPx = 180;
instructions.getRange("B:B").format.columnWidthPx = 340;
instructions.getRange("D:D").format.columnWidthPx = 170;
instructions.getRange("E:E").format.columnWidthPx = 180;
instructions.getRange("F:F").format.columnWidthPx = 280;

template.getRange("A1:I1").values = [[
  "nombre_completo",
  "cedula",
  "celular",
  "fecha_de_nacimiento",
  "correo",
  "bautizados",
  "rol",
  "estado",
  "notas"
]];
template.getRange("A1:H1").format = {
  fill: "#101828",
  font: { bold: true, color: "#FFFFFF" },
  horizontalAlignment: "Center"
};

template.getRange("A2:I6").values = [
  ["Ana Torres", "1060000001", "3000001111", new Date("2009-04-20"), "ana@example.com", "SI", "Miembro", "activo", "Se integra al equipo creativo."],
  ["Luis Herrera", "1000000002", "3015550000", new Date("2007-04-18"), "luis@example.com", "NO", "Lider", "activo", "Asiste con regularidad."],
  ["", "", "", null, "", "", "", "", ""],
  ["", "", "", null, "", "", "", "", ""],
  ["", "", "", null, "", "", "", "", ""]
];
template.getRange("D2:D200").setNumberFormat("yyyy-mm-dd");
template.getRange("A1:I200").format.borders = {
  top: { style: "Continuous", color: "#EAECF0" },
  bottom: { style: "Continuous", color: "#EAECF0" },
  left: { style: "Continuous", color: "#EAECF0" },
  right: { style: "Continuous", color: "#EAECF0" }
};
template.getRange("A2:I200").format = {
  fill: "#FFFFFF"
};
template.getRange("F2:F200").dataValidation = {
  rule: { type: "list", values: ["SI", "NO"] }
};
template.getRange("G2:G200").dataValidation = {
  rule: { type: "list", values: ["Miembro", "Lider", "Mentor", "Diacono"] }
};
template.getRange("H2:H200").dataValidation = {
  rule: { type: "list", values: ["activo", "inactivo"] }
};
template.getRange("A:A").format.columnWidthPx = 220;
template.getRange("B:B").format.columnWidthPx = 140;
template.getRange("C:C").format.columnWidthPx = 130;
template.getRange("D:D").format.columnWidthPx = 130;
template.getRange("E:E").format.columnWidthPx = 220;
template.getRange("F:F").format.columnWidthPx = 100;
template.getRange("G:G").format.columnWidthPx = 120;
template.getRange("H:H").format.columnWidthPx = 100;
template.getRange("I:I").format.columnWidthPx = 300;

const templateTable = template.tables.add("A1:I200", true, "ImportYouthTemplate");
templateTable.style = "TableStyleMedium2";

const check = await workbook.inspect({
  kind: "table",
  range: "Jovenes!A1:I6",
  include: "values,formulas",
  tableMaxRows: 6,
  tableMaxCols: 9
});
console.log(check.ndjson);

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);

console.log(outputPath);
