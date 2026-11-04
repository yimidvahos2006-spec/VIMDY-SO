// @vitest-environment jsdom
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CookieConsent } from "../../src/marketing/components/CookieConsent";
import { Footer } from "../../src/marketing/components/Footer";
import { COOKIE_CONSENT_KEY, readCookieConsent } from "../../src/marketing/cookieConsent";

function renderSite() {
  return render(
    createElement(MemoryRouter, null, createElement(Footer), createElement(CookieConsent)),
  );
}

describe("CookieConsent + Footer (solo cookies técnicas)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("el banner solo habla de cookies técnicas y no menciona análisis ni rastreo", () => {
    renderSite();
    const region = screen.getByRole("region", { name: "Aviso de cookies" });

    expect(region.textContent).toMatch(/cookies técnicas/i);
    expect(region.textContent).not.toMatch(/an[aá]lisis|anal[ií]tic|rastre|tracking/i);
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("'Entendido' guarda la decisión (sin analítica) y cierra el banner", () => {
    renderSite();
    fireEvent.click(screen.getByRole("button", { name: "Entendido" }));

    expect(screen.queryByRole("region", { name: "Aviso de cookies" })).toBeNull();
    expect(readCookieConsent()?.analytics).toBe(false);
  });

  it("el Footer tiene 'Preferencias de cookies' y reabre el panel tras haber decidido", () => {
    renderSite();
    fireEvent.click(screen.getByRole("button", { name: "Entendido" }));
    expect(screen.queryByRole("region", { name: "Aviso de cookies" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Preferencias de cookies" }));

    const region = screen.getByRole("region", { name: "Aviso de cookies" });
    expect(region.textContent).toMatch(/Técnicas \(necesarias\)/);
    expect(region.textContent).not.toMatch(/an[aá]lisis|anal[ií]tic|rastre|tracking/i);
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("cerrar el panel reabierto conserva la decisión previa", () => {
    renderSite();
    fireEvent.click(screen.getByRole("button", { name: "Entendido" }));
    const before = window.localStorage.getItem(COOKIE_CONSENT_KEY);

    fireEvent.click(screen.getByRole("button", { name: "Preferencias de cookies" }));
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));

    expect(screen.queryByRole("region", { name: "Aviso de cookies" })).toBeNull();
    expect(window.localStorage.getItem(COOKIE_CONSENT_KEY)).toBe(before);
  });
});