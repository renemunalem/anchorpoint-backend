import cors from "cors";
import { env } from "./env";

export const corsOptions: cors.CorsOptions = {
  origin(origin, callback) {
    if (!origin || env.frontendOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error(`Origin not allowed: ${origin}`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "X-Session-Id", "X-CSRF-TOKEN"],
};

export const corsMiddleware = cors(corsOptions);
