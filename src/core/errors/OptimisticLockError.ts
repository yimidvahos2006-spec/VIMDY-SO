// src/core/errors/OptimisticLockError.ts
/* ===========================================================================
   OptimisticLockError
   ---------------------------------------------------------------------------
   CRÍTICO #6 del checklist de lanzamiento — "Bloqueo optimista (o versión)
   en las actualizaciones". Se lanza cuando dos personas editan el MISMO
   registro (ej. la misma mesa) casi al mismo tiempo: el segundo en guardar
   ya no está partiendo de la versión más reciente, así que en vez de
   pisar silenciosamente el cambio del primero, SupabaseRepository.update()
   rechaza el guardado y lanza este error.

   Quién la atrapa:
     - Cualquier pantalla que llame a un engine que termine en
       IRepository.update() (mesas, comandas de cocina, turnos de caja,
       inventario, etc) puede hacer `catch (err) { if (err instanceof
       OptimisticLockError) { ...} }` para mostrar un mensaje amigable y
       refrescar los datos en vez de mostrar un error genérico.
     - Si nadie la atrapa explícitamente, su `.message` ya es un texto
       entendible por el usuario final (ver ErrorBoundary.tsx / los
       `errorMsg` que ya existen en los diálogos de mesas), así que nunca
       es peor que un error normal — solo puede ser mejor.
=========================================================================== */

export class OptimisticLockError extends Error {
  /** Nombre de la tabla/entidad en conflicto (ej. "tables"). */
  public readonly entity: string;
  /** id del registro que alguien más modificó primero. */
  public readonly id: string;

  constructor(entity: string, id: string) {
    super(
      "Alguien más actualizó esto justo ahora. Se recargó la información " +
        "más reciente — revisa los cambios y vuelve a intentar."
    );
    this.name = "OptimisticLockError";
    this.entity = entity;
    this.id = id;
  }
}

/** Type guard cómodo para los `catch (err)` de la capa de presentación. */
export function isOptimisticLockError(err: unknown): err is OptimisticLockError {
  return err instanceof OptimisticLockError;
}