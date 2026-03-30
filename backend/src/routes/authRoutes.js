import express from "express";
import {
  registerUser,
  loginUser,
  logoutUser,
  getMe,
} from "../controllers/authController.js";

const router = express.Router();

router.post("/register", registerUser); // optional after first setup
router.post("/login", loginUser);
router.post("/logout", logoutUser);
router.get("/me", getMe);

export default router;