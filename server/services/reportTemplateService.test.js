import { describe, it, expect, beforeEach } from "vitest";
import db, { initDb } from "../db.js";
import { listTemplates, createTemplate, updateTemplate, deleteTemplate, seedReportTemplates, DEFAULT_TEMPLATES } from "./reportTemplateService.js";

describe("reportTemplateService", () => {
  beforeEach(() => {
    initDb();
    db.prepare("DELETE FROM report_templates").run();
  });

  it("seeds default templates only when the table is empty (idempotent)", () => {
    seedReportTemplates();
    const first = listTemplates().length;
    expect(first).toBe(DEFAULT_TEMPLATES.length);
    seedReportTemplates();
    expect(listTemplates().length).toBe(first);
  });

  it("adds missing default templates to an existing table without duplicating", () => {
    db.prepare("INSERT INTO report_templates (name, prompt, is_public) VALUES ('每日能源要闻日报', '旧提示词', 1)").run();
    seedReportTemplates();
    const rows = listTemplates();
    expect(rows.length).toBe(DEFAULT_TEMPLATES.length);
    const daily = rows.find(t => t.name === "每日能源要闻日报");
    expect(daily.prompt).not.toBe("旧提示词");
    expect(rows.filter(t => t.name === "每日能源要闻日报")).toHaveLength(1);
  });

  it("default templates include the generic industry-interpretation template with purpose/audience placeholders", () => {
    seedReportTemplates();
    const generic = listTemplates().find(t => t.name.includes("专题解读"));
    expect(generic).toBeTruthy();
    expect(generic.prompt).toContain("{{purpose}}");
    expect(generic.prompt).toContain("{{audience}}");
  });

  it("creates, updates and deletes a custom template", () => {
    const created = createTemplate({ name: "测试模板", prompt: "编写报告", max_cards: 5, is_public: 0 });
    expect(created.id).toBeGreaterThan(0);
    expect(created.is_public).toBe(false);
    const updated = updateTemplate(created.id, { name: "测试模板2", prompt: "新提示词" });
    expect(updated.name).toBe("测试模板2");
    expect(listTemplates().some(t => t.id === created.id && t.name === "测试模板2")).toBe(true);
    deleteTemplate(created.id);
    expect(listTemplates().some(t => t.id === created.id)).toBe(false);
  });

  it("default templates are public and carry max_cards", () => {
    seedReportTemplates();
    const templates = listTemplates();
    expect(templates.every(t => t.is_public === true)).toBe(true);
    expect(templates.every(t => t.max_cards > 0)).toBe(true);
  });

  it("refuses to delete a public template", () => {
    seedReportTemplates();
    const first = listTemplates()[0];
    expect(() => deleteTemplate(first.id)).toThrow(/public/i);
  });
});
