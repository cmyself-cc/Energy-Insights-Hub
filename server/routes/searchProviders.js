import { Router } from "express";
import {
  listSearchProviders, createSearchProvider, updateSearchProvider,
  deleteSearchProvider, activateSearchProvider
} from "../services/searchProviderService.js";

const router = Router();

router.get("/", (_req, res) => {
  try { res.json({ data: listSearchProviders() }); } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/", (req, res) => {
  try { const row = createSearchProvider(req.body); res.status(201).json({ data: row }); } catch (e) { res.status(400).json({ error: e.message }); }
});

router.put("/:id", (req, res) => {
  try { const row = updateSearchProvider(Number(req.params.id), req.body); res.json({ data: row }); } catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete("/:id", (req, res) => {
  try { deleteSearchProvider(Number(req.params.id)); res.json({ success: true }); } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post("/:id/activate", (req, res) => {
  try { const row = activateSearchProvider(Number(req.params.id)); res.json({ data: row }); } catch (e) { res.status(400).json({ error: e.message }); }
});

export default router;
