import ratelimit from "../config/upstash.js";

const rateLimiter = async (req, res, next) => {
  try {
    // 🚫 Skip rate limit for authentication routes
    if (req.path.startsWith("/auth")) {
      return next();
    }

    const key = req.ip || "unknown";

    const { success } = await ratelimit.limit(`api-${key}`);

    if (!success) {
      return res.status(429).json({
        message: "Too many requests. Please try again later.",
      });
    }

    next();
  } catch (error) {
    console.log("Rate limit error", error);
    next(error);
  }
};

export default rateLimiter;
