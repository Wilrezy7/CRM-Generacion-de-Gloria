import { env } from "../config/env.js";

export const sendEmail = async ({ to, subject, text, metadata = {} }) => {
  if (env.emailDeliveryMode === "webhook" && env.emailWebhookUrl) {
    await fetch(env.emailWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to, subject, text, metadata })
    });
    return { delivered: true, mode: "webhook" };
  }

  console.log(
    JSON.stringify({
      level: "info",
      event: "email.queued",
      mode: "log",
      to,
      subject,
      text,
      metadata
    })
  );
  return { delivered: false, mode: "log" };
};

