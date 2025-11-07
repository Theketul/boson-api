const axios = require("axios");
require("dotenv").config();

const WHATSAPP_API_URL = "https://graph.facebook.com/v24.0";
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const ACCESS_TOKEN = process.env.WHATSAPP_PERMANENT_ACCESS_TOKEN;

/**
 * Normalize Indian phone number to include country code 91
 * Validates and formats Indian phone numbers
 * @param {string} phoneNumber - Phone number (with or without country code)
 * @returns {string} - Normalized phone number with country code (91XXXXXXXXXX)
 */
function normalizeIndianPhoneNumber(phoneNumber) {
  if (!phoneNumber) {
    throw new Error("Phone number is required");
  }

  // Remove all non-digit characters
  let cleaned = phoneNumber.toString().replace(/\D/g, "");

  // Remove leading zeros if present
  cleaned = cleaned.replace(/^0+/, "");

  // Check if it already starts with 91 (India country code)
  if (cleaned.startsWith("91")) {
    // Remove the country code to check the actual number
    const numberWithoutCountryCode = cleaned.substring(2);
    
    // Indian mobile numbers are 10 digits (after removing country code)
    if (numberWithoutCountryCode.length === 10) {
      // Validate it's a valid Indian mobile number (starts with 6-9)
      if (/^[6-9]/.test(numberWithoutCountryCode)) {
        return cleaned; // Already has country code and is valid
      } else {
        throw new Error(`Invalid Indian mobile number: ${phoneNumber}. Must start with 6, 7, 8, or 9`);
      }
    } else {
      throw new Error(`Invalid Indian phone number length: ${phoneNumber}. Expected 10 digits after country code`);
    }
  } else {
    // No country code, check if it's a valid 10-digit Indian number
    if (cleaned.length === 10) {
      // Validate it's a valid Indian mobile number (starts with 6-9)
      if (/^[6-9]/.test(cleaned)) {
        return "91" + cleaned; // Add country code
      } else {
        throw new Error(`Invalid Indian mobile number: ${phoneNumber}. Must start with 6, 7, 8, or 9`);
      }
    } else {
      throw new Error(`Invalid Indian phone number length: ${phoneNumber}. Expected 10 digits`);
    }
  }
}

// Template configurations mapping
const TEMPLATE_CONFIG = {
  task_delayed: {
    language: "en",
    hasButton: true,
  },
  project_assignment_project_manager: {
    language: "en",
    hasButton: true,
  },
  task_assignment_tech: {
    language: "en",
    hasButton: true,
  },
  task_resubmission_project_manager: {
    language: "en",
    hasButton: true,
  },
  task_submission_project_manager: {
    language: "en",
    hasButton: true,
  },
};

/**
 * Build template components (body parameters and optional CTA button)
 */
function buildTemplateComponents(templateName, bodyParams = [], ctaParam = null) {
  const config = TEMPLATE_CONFIG[templateName];

  if (!config) {
    throw new Error(`Template configuration not found for: ${templateName}`);
  }

  const components = [];

  if (bodyParams.length > 0) {
    components.push({
      type: "body",
      parameters: bodyParams.map((param) => ({
        type: "text",
        text: String(param ?? ""),
      })),
    });
  }

  if (config.hasButton) {
    if (!ctaParam) {
      throw new Error(`CTA parameter is required for template ${templateName}`);
    }

    components.push({
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [
        {
          type: "text",
          text: String(ctaParam),
        },
      ],
    });
  }

  return components;
}

exports.sendWhatsAppTemplate = async (
  to,
  templateName,
  bodyParams = [],
  ctaParam = null
) => {
  try {
    console.log(">" .repeat(50));
    // Normalize phone number to include Indian country code (91)
    const normalizedPhone = normalizeIndianPhoneNumber(to);
    const config = TEMPLATE_CONFIG[templateName];

    if (!config) {
      throw new Error(`Template configuration not found for: ${templateName}`);
    }

    const components = buildTemplateComponents(templateName, bodyParams, ctaParam);

    const payload = {
      messaging_product: "whatsapp",
      to: normalizedPhone,
      type: "template",
      template: {
        name: templateName,
        language: { code: config.language || "en" },
        ...(components.length > 0 ? { components } : {}),
      },
    };
  console.log("=" .repeat(50));

    console.log("payload", JSON.stringify(payload, null, 2));
    const response = await axios.post(
      `${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/messages`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log(`✅ WhatsApp message sent:`, response.data);
    return response.data;
  } catch (error) {
    console.error(
      "❌ WhatsApp send error:",
      error.response?.data || error.message
    );
    throw error;
  }
};
