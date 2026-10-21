import React, { useMemo, useState } from "react";
import { Download, FileSpreadsheet, X, CheckCircle2, AlertTriangle } from "lucide-react";
import { VimdyButton } from "../ui/VimdyButton";
import type { Category, Product } from "../../../core/entities/Entities";
import { container } from "../../../infrastructure/di/CompositionRoot";
import { runCsvImport, ImportOutcome } from "../../../application/inventory/importProductsFromCsv";
import {
  buildImportPlan,
  buildTemplateCsv,
  DuplicateMode,
  ImportRow,
  parseImportCsv
} from "./csvImport";

interface CsvImportModalProps {
  onClose: () => void;
  /** Productos e insumos que ya existen (para detectar duplicados). */
  existingProducts: Product[];
  performedBy?: string;
  /** Recarga Inventario y Caja cuando termina la importación. */
  onImported: () => Promise<void> | void;
}

type Screen = "choose" | "review" | "importing" | "done";

const ACTION_LABEL = { create: "Nuevo", update: "Actualizar", skip: "Ya existe", error: "Con error" } as const;
const ACTION_STYLE = {
  create: "text-vimdy-success",
  update: "text-vimdy-accent",
  skip: "text-vimdy-text-tertiary",
  error: "text-vimdy-danger"
} as const;

function downloadTemplate() {
  const blob = new Blob([buildTemplateCsv()], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "plantilla-productos-vimdy.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export function CsvImportModal({ onClose, existingProducts, performedBy, onImported }: CsvImportModalProps) {
  const [screen, setScreen] = useState<Screen>("choose");
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [ignored, setIgnored] = useState<string[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [duplicateMode, setDuplicateMode] = useState<DuplicateMode>("skip");
  const [confirmCategories, setConfirmCategories] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);

  const plan = useMemo(
    () => buildImportPlan(rows, existingProducts, categories, duplicateMode),
    [rows, existingProducts, categories, duplicateMode]
  );
  const duplicates = plan.planned.filter((p) => p.existing).length;
  const importable = plan.counts.create + plan.counts.update;
  const needsCategoryOk = plan.missingCategories.length > 0 && !confirmCategories;

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setFileError(null);
    if (!/\.(csv|txt)$/i.test(file.name)) {
      setFileError("Por ahora solo archivos .csv. En Excel: Archivo → Guardar como → CSV UTF-8.");
      return;
    }
    try {
      const parsed = parseImportCsv(await file.text());
      if (parsed.fatalError) {
        setFileError(parsed.fatalError);
        return;
      }
      setCategories(await container.categoryEngine.get().listAll());
      setRows(parsed.rows);
      setIgnored(parsed.ignoredColumns);
      setConfirmCategories(false);
      setScreen("review");
    } catch {
      setFileError("No pude leer el archivo. Guárdalo de nuevo como CSV UTF-8.");
    }
  }

  async function handleImport() {
    setScreen("importing");
    setProgress({ done: 0, total: importable });
    setFatal(null);
    try {
      const result = await runCsvImport(plan, performedBy, (done, total) => setProgress({ done, total }));
      setOutcome(result);
      await onImported();
    } catch (error) {
      setFatal(error instanceof Error ? error.message : "No se pudo importar.");
    }
    setScreen("done");
  }

  // Los errores primero, para que se vean sin buscar.
  const visibleRows = useMemo(() => {
    const order = { error: 0, update: 1, create: 2, skip: 3 } as const;
    return [...plan.planned].sort((a, b) => order[a.action] - order[b.action] || a.row.line - b.row.line).slice(0, 200);
  }, [plan]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={screen === "importing" ? undefined : onClose}>
      <div
        className={`w-full ${screen === "review" ? "max-w-3xl" : "max-w-lg"} max-h-[90vh] overflow-y-auto rounded-vimdy-lg border border-vimdy-border bg-vimdy-surface p-6`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-2">
            <FileSpreadsheet size={20} className="text-vimdy-accent" />
            <h2 className="text-xl font-bold text-vimdy-text">Importar desde Excel (CSV)</h2>
          </div>
          {screen !== "importing" && (
            <button onClick={onClose} aria-label="Cerrar" className="text-vimdy-text-secondary hover:text-vimdy-text">
              <X size={20} />
            </button>
          )}
        </div>

        {screen === "choose" && (
          <>
            <ol className="text-sm text-vimdy-text-secondary space-y-2 mb-5 list-decimal pl-5">
              <li>Descarga la plantilla y llénala en Excel.</li>
              <li>Guárdala como <b>CSV UTF-8</b> (Archivo → Guardar como).</li>
              <li>Súbela aquí: verás una revisión antes de guardar nada.</li>
            </ol>
            <div className="flex flex-col gap-3">
              <VimdyButton variant="secondary" onClick={downloadTemplate}>
                <Download size={16} /> Descargar plantilla
              </VimdyButton>
              <label className="h-11 rounded-vimdy-md bg-vimdy-accent text-vimdy-background font-bold flex items-center justify-center gap-2 cursor-pointer hover:opacity-90">
                <FileSpreadsheet size={16} /> Elegir archivo CSV
                <input type="file" accept=".csv,.txt,text/csv" className="hidden" onChange={handleFile} />
              </label>
            </div>
            {fileError && <p role="alert" className="mt-4 text-sm text-vimdy-danger">{fileError}</p>}
          </>
        )}

        {screen === "review" && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4 text-center">
              {(["create", "update", "skip", "error"] as const).map((key) => (
                <div key={key} className="rounded-vimdy-md border border-vimdy-border p-2">
                  <p className={`text-xl font-bold ${ACTION_STYLE[key]}`}>{plan.counts[key]}</p>
                  <p className="text-xs text-vimdy-text-tertiary">{ACTION_LABEL[key]}</p>
                </div>
              ))}
            </div>

            {duplicates > 0 && (
              <fieldset className="mb-4 text-sm text-vimdy-text-secondary">
                <legend className="font-semibold text-vimdy-text mb-1">{duplicates} ya existen. ¿Qué hacemos con ellos?</legend>
                <label className="flex items-center gap-2 py-0.5">
                  <input type="radio" name="dup" checked={duplicateMode === "skip"} onChange={() => setDuplicateMode("skip")} />
                  Omitirlos (no se toca nada)
                </label>
                <label className="flex items-center gap-2 py-0.5">
                  <input type="radio" name="dup" checked={duplicateMode === "update"} onChange={() => setDuplicateMode("update")} />
                  Actualizar precio, costo y categoría (el stock no cambia)
                </label>
              </fieldset>
            )}

            {plan.missingCategories.length > 0 && (
              <label className="mb-4 flex items-start gap-2 text-sm text-vimdy-text-secondary rounded-vimdy-md border border-vimdy-border p-3">
                <input type="checkbox" className="mt-1" checked={confirmCategories} onChange={(e) => setConfirmCategories(e.target.checked)} />
                <span>
                  Crear las categorías nuevas: <b>{plan.missingCategories.map((c) => c.name).join(", ")}</b>
                </span>
              </label>
            )}

            {ignored.length > 0 && (
              <p className="mb-3 text-xs text-vimdy-text-tertiary">Columnas ignoradas: {ignored.join(", ")}.</p>
            )}

            <div className="rounded-vimdy-md border border-vimdy-border overflow-hidden mb-4">
              <div className="max-h-72 overflow-y-auto divide-y divide-vimdy-border text-sm">
                {visibleRows.map(({ row, action, errors }) => (
                  <div key={row.line} className="px-3 py-2 flex gap-3">
                    <span className="w-8 shrink-0 text-vimdy-text-tertiary">{row.line}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-vimdy-text truncate">{row.name || "(sin nombre)"}</p>
                      {errors.map((e) => (
                        <p key={e} className="text-xs text-vimdy-danger">{e}</p>
                      ))}
                      {row.warnings.map((w) => (
                        <p key={w} className="text-xs text-vimdy-text-tertiary">{w}</p>
                      ))}
                    </div>
                    <span className={`shrink-0 text-xs font-semibold ${ACTION_STYLE[action]}`}>{ACTION_LABEL[action]}</span>
                  </div>
                ))}
              </div>
              {plan.planned.length > visibleRows.length && (
                <p className="px-3 py-2 text-xs text-vimdy-text-tertiary border-t border-vimdy-border">
                  Mostrando {visibleRows.length} de {plan.planned.length} filas (primero las que tienen error).
                </p>
              )}
            </div>

            {plan.counts.error > 0 && (
              <p className="mb-3 text-xs text-vimdy-text-secondary">
                Las filas con error no se importan. Corrígelas en Excel y vuelve a subir el archivo, o importa solo las que están bien.
              </p>
            )}

            <div className="flex gap-3">
              <VimdyButton variant="secondary" onClick={() => setScreen("choose")}>Elegir otro archivo</VimdyButton>
              <VimdyButton variant="primary" onClick={handleImport} disabled={importable === 0 || needsCategoryOk} className="flex-1">
                {importable === 0 ? "Nada para importar" : `Importar ${importable}`}
              </VimdyButton>
            </div>
            {needsCategoryOk && <p className="mt-2 text-xs text-vimdy-text-tertiary">Marca la casilla para crear las categorías nuevas.</p>}
          </>
        )}

        {screen === "importing" && (
          <div className="py-10 text-center">
            <p className="text-vimdy-text font-semibold mb-3">Guardando productos… no cierres esta ventana.</p>
            <div className="w-full h-2 rounded-full bg-vimdy-background overflow-hidden">
              <div className="h-full bg-vimdy-accent transition-all" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
            </div>
            <p className="mt-2 text-sm text-vimdy-text-secondary">{progress.done} de {progress.total}</p>
          </div>
        )}

        {screen === "done" && (
          <>
            {fatal ? (
              <p role="alert" className="flex gap-2 text-sm text-vimdy-danger"><AlertTriangle size={18} /> {fatal}</p>
            ) : (
              outcome && (
                <>
                  <p className="flex items-center gap-2 text-vimdy-text font-semibold mb-3">
                    <CheckCircle2 size={18} className="text-vimdy-success" />
                    {outcome.created} creados · {outcome.updated} actualizados · {outcome.skipped} omitidos
                  </p>
                  {outcome.failed.length > 0 && (
                    <div className="rounded-vimdy-md border border-vimdy-border p-3 text-sm">
                      <p className="font-semibold text-vimdy-danger mb-1">{outcome.failed.length} no se pudieron guardar:</p>
                      <ul className="max-h-48 overflow-y-auto space-y-1 text-vimdy-text-secondary">
                        {outcome.failed.map((f) => (
                          <li key={`${f.line}-${f.name}`}>Fila {f.line} · {f.name}: {f.error}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )
            )}
            <div className="mt-5"><VimdyButton variant="primary" onClick={onClose} className="w-full">Listo</VimdyButton></div>
          </>
        )}
      </div>
    </div>
  );
}