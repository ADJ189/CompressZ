/**
 * formPdf.ts — Inspect, edit, fill, and flatten interactive PDF AcroForms.
 *
 * Supports text fields, checkboxes, dropdowns, and option lists.
 * Provides true vector flattening via pdf-lib form.flatten() to make form
 * entries permanently immutable.
 */

import { getPdfLib } from "../pdfLibs";

export type FormFieldType = "text" | "checkbox" | "dropdown" | "radio" | "unknown";

export interface FormFieldInfo {
  name: string;
  type: FormFieldType;
  value: string | boolean;
  options?: string[]; // for dropdowns and radio buttons
  readOnly?: boolean;
}

export interface FormFillValue {
  name: string;
  value: string | boolean;
}

export interface FormInspectionResult {
  hasForm: boolean;
  fields: FormFieldInfo[];
  pageCount: number;
}

/**
 * Inspect a PDF document and extract all interactive form fields.
 */
export async function inspectPdfForm(pdfBytes: Uint8Array): Promise<FormInspectionResult> {
  const { PDFDocument, PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup } = await getPdfLib();
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const pageCount = pdfDoc.getPageCount();

  let form: any;
  try {
    form = pdfDoc.getForm();
  } catch {
    return { hasForm: false, fields: [], pageCount };
  }

  const rawFields = form.getFields();
  if (!rawFields || rawFields.length === 0) {
    return { hasForm: false, fields: [], pageCount };
  }

  const fields: FormFieldInfo[] = [];

  for (const f of rawFields) {
    const name = f.getName();
    let type: FormFieldType = "unknown";
    let value: string | boolean = "";
    let options: string[] | undefined;

    if (f instanceof PDFTextField) {
      type = "text";
      try {
        value = f.getText() || "";
      } catch {
        value = "";
      }
    } else if (f instanceof PDFCheckBox) {
      type = "checkbox";
      try {
        value = f.isChecked();
      } catch {
        value = false;
      }
    } else if (f instanceof PDFDropdown) {
      type = "dropdown";
      try {
        const sel = f.getSelected();
        value = sel && sel.length > 0 ? sel[0] : "";
        options = f.getOptions();
      } catch {
        value = "";
      }
    } else if (f instanceof PDFRadioGroup) {
      type = "radio";
      try {
        value = f.getSelected() || "";
        options = f.getOptions();
      } catch {
        value = "";
      }
    }

    fields.push({
      name,
      type,
      value,
      options,
      readOnly: f.isReadOnly ? f.isReadOnly() : false,
    });
  }

  return {
    hasForm: fields.length > 0,
    fields,
    pageCount,
  };
}

/**
 * Apply updated values to AcroForm fields and optionally flatten the form.
 */
export async function fillPdfForm(
  pdfBytes: Uint8Array,
  values: FormFillValue[],
  flatten: boolean = false,
  onProgress?: (pct: number) => void,
): Promise<Uint8Array> {
  onProgress?.(10);

  const { PDFDocument, PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup } = await getPdfLib();
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });

  let form: any;
  try {
    form = pdfDoc.getForm();
  } catch {
    throw new Error("This PDF does not contain an interactive AcroForm structure.");
  }

  onProgress?.(30);

  for (let i = 0; i < values.length; i++) {
    const { name, value } = values[i];
    try {
      const field = form.getField(name);
      if (!field) continue;

      if (field instanceof PDFTextField && typeof value === "string") {
        field.setText(value);
      } else if (field instanceof PDFCheckBox && typeof value === "boolean") {
        if (value) field.check();
        else field.uncheck();
      } else if (field instanceof PDFDropdown && typeof value === "string") {
        field.select(value);
      } else if (field instanceof PDFRadioGroup && typeof value === "string") {
        const validOptions = field.getOptions();
        if (validOptions.length > 0 && !validOptions.includes(value)) {
          throw new Error(
            `Invalid radio option "${value}" for field "${name}". Valid options: ${validOptions.join(", ")}`,
          );
        }
        field.select(value);
      }
    } catch (err) {
      console.warn(`[formPdf] Could not set field "${name}":`, err);
    }

    const pct = Math.round(30 + ((i + 1) / values.length) * 50);
    onProgress?.(pct);
  }

  if (flatten) {
    onProgress?.(85);
    // Flatten fields into immutable page graphics
    form.flatten();
  }

  const result = await pdfDoc.save();
  onProgress?.(100);
  return result;
}
