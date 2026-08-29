import express from "express";
import { login, changePassword, getProfile, updateProfile } from "../controllers/authController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/login", login);
router.get("/me", authMiddleware, getProfile);
router.put("/profile", authMiddleware, updateProfile);
router.put("/password", authMiddleware, changePassword);
// Mantendo a rota antiga para não quebrar nada
router.post("/change-password", authMiddleware, changePassword);

export default router;