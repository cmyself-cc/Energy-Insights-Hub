import { Router } from "express";
import { listViews, createView, updateView, deleteView, setDefault, getView } from "../services/viewService.js";

const router = Router();

router.get("/", (req, res) => res.json({ data: listViews(req.user.id) }));
router.post("/", (req, res) => {
  const r = createView(req.user.id, req.body || {});
  if (r.error) return res.status(400).json({ error: r.error });
  res.json({ data: r.view });
});
router.put("/:id", (req, res) => {
  const r = updateView(req.user.id, Number(req.params.id), req.body || {});
  if (r.error === "not found") return res.status(404).json({ error: "not found" });
  if (r.error) return res.status(400).json({ error: r.error });
  res.json({ data: r.view });
});
router.delete("/:id", (req, res) => {
  if (!deleteView(req.user.id, Number(req.params.id))) return res.status(404).json({ error: "not found" });
  res.json({ data: { success: true } });
});
router.post("/:id/default", (req, res) => {
  if (!setDefault(req.user.id, Number(req.params.id))) return res.status(404).json({ error: "not found" });
  res.json({ data: getView(req.user.id, Number(req.params.id)) });
});

export default router;
