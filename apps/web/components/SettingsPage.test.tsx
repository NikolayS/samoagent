import { describe, it, expect } from "bun:test";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { SettingsPage } from "./SettingsPage.tsx";
import { createFakeAppApiClient } from "../lib/fakeAppApiClient.ts";
import { installDom } from "../test/setup.tsx";

installDom();

/**
 * Greenroom Settings page (SPEC §5.12). It loads the tenant's hosted settings
 * (dictionary preset + keyterms, language, chat chime), renders them into a
 * form, and PUTs the edited document back. Auth-gated like the dashboard.
 */
describe("SettingsPage — hosted per-tenant settings (§5.12)", () => {
  it("loads and renders the tenant's current settings", async () => {
    const client = createFakeAppApiClient({
      seedSettings: {
        dictionaryPreset: "postgresfm",
        keyterms: ["WAL", "pg_stat_statements"],
        language: "es",
        chime: "bell",
      },
    });
    const { findByLabelText } = render(<SettingsPage client={client} redirect={() => {}} />);

    const lang = (await findByLabelText(/language/i)) as HTMLSelectElement;
    expect(lang.value).toBe("es");
    const terms = (await findByLabelText(/keyterms/i)) as HTMLTextAreaElement;
    expect(terms.value.split(/\n/)).toEqual(["WAL", "pg_stat_statements"]);
    const chime = (await findByLabelText(/chime/i)) as HTMLSelectElement;
    expect(chime.value).toBe("bell");
    const preset = (await findByLabelText(/preset/i)) as HTMLSelectElement;
    expect(preset.value).toBe("postgresfm");
  });

  it("edits and saves — PUTs the new document and confirms", async () => {
    const client = createFakeAppApiClient({
      seedSettings: {
        dictionaryPreset: "none",
        keyterms: [],
        language: "multi",
        chime: "blip",
      },
    });
    const { findByLabelText, getByRole, findByText } = render(
      <SettingsPage client={client} redirect={() => {}} />,
    );

    fireEvent.change(await findByLabelText(/language/i), { target: { value: "de" } });
    fireEvent.change(await findByLabelText(/keyterms/i), {
      target: { value: "autovacuum\npgbouncer" },
    });
    fireEvent.change(await findByLabelText(/chime/i), { target: { value: "glass" } });

    const save = getByRole("button", { name: "Save settings" });
    expect(save.className).toContain("samograph-btn samograph-btn--primary");
    fireEvent.click(save);

    const saved = await findByText("Settings saved.");
    expect(saved.getAttribute("role")).toBe("status");
    expect(saved.className).toContain("samograph-alert samograph-alert--success");
    const put = client.requests.find((r) => r.method === "PUT" && r.path === "/settings");
    expect(put).toBeDefined();
    expect(put!.body).toEqual({
      dictionary_preset: "none",
      keyterms: ["autovacuum", "pgbouncer"],
      language: "de",
      chime: "glass",
    });
  });

  it("marks Save settings busy and disabled while saving", async () => {
    const client = createFakeAppApiClient();
    client.saveSettings = () => new Promise(() => {});
    const view = render(<SettingsPage client={client} redirect={() => {}} />);
    const save = await view.findByRole("button", { name: "Save settings" }) as HTMLButtonElement;
    fireEvent.click(save);
    expect(save.disabled).toBe(true);
    expect(save.getAttribute("aria-busy")).toBe("true");
  });

  it("styles save failures as error alerts", async () => {
    const client = createFakeAppApiClient({
      failSaveSettingsWith: { code: "SAMO-SETTINGS", message: "Could not save.", status: 500 },
    });
    const view = render(<SettingsPage client={client} redirect={() => {}} />);
    fireEvent.click(await view.findByRole("button", { name: "Save settings" }));
    const alert = await view.findByRole("alert");
    expect(alert.textContent).toBe("Could not save.");
    expect(alert.className).toContain("samograph-alert samograph-alert--error");
  });

  it("redirects to sign-in when loading settings 401s", async () => {
    const client = createFakeAppApiClient({
      failGetSettingsWith: { code: "SAMO-AUTHZ-001", message: "no", status: 401 },
    });
    let to: string | null = null;
    render(<SettingsPage client={client} redirect={(p) => (to = p)} />);
    await waitFor(() => expect(to).toBe("/auth"));
  });
});
