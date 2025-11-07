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
    header: "Task Delayed Notification",
    body: "The following task is delayed by *{{1}}* days.  \n\n*Task*: {{2}}  \n*Project*: {{3}}  \n*Product*: {{4}}  \n*Primary Owner*: {{5}}  \n*Secondary Owner*: {{6}}  \n*Timeline*: {{7}} *to* {{8}}  \n\nPlease make sure the task is updated as soon as possible.",
    footer: 'Type "STOP" to unsubscribe',
    buttonText: "View Task",
    urlPattern: "https://ops.waters.co.in/task-detail/{{1}}",
    hasButton: true,
  },
  project_assignment_project_manager: {
    header: "Project Assignment",
    body: "You are assigned ownership of a new project: *{{1}}* by *{{2}}*.\n\nYou can start planning",
    footer: 'Type "STOP" to unsubscribe',
    buttonText: "View Project",
    urlPattern: "https://ops.waters.co.in/project-detail/{{1}}",
    hasButton: true,
  },
  task_assignment_tech: {
    header: "New Task Assigned",
    body: "*Task Assignment Alert!*\n\n*Task:* {{1}}\n*Project:* {{2}}\n\nPlease make sure to upload daily updates and complete it within the deadline .",
    footer: 'Type "STOP" to unsubscribe',
    buttonText: "View Task",
    urlPattern: "https://ops.waters.co.in/task-detail/{{1}}",
    hasButton: true,
  },
  task_resubmission_project_manager: {
    header: "Task Resubmitted",
    body: "*Task Resubmitted!*  \n\n*Resubmitted by:* {{1}}  \n*Task:* {{2}}  \n*Project:* {{3}}  \n*Product:* {{4}}  \n\nPlease connect with your Project Manager and update the task accordingly.",
    footer: 'Type "STOP" to unsubscribe',
    buttonText: "View Task",
    urlPattern: "https://ops.waters.co.in/task-detail/{{1}}",
    hasButton: true,
  },
  task_submission_project_manager: {
    header: "Task Submitted for Review",
    body: "*Submitted by:* {{1}}  \n*Task:* {{2}}  \n*Project:* {{3}}  \n*Product:* {{4}}  \n*Submitted on:* {{5}}  \n\nPlease review the task and ensure all updates are uploaded.  \nComplete it within the deadline.",
    footer: 'Type "STOP" to unsubscribe',
    buttonText: "View Task",
    urlPattern: "https://ops.waters.co.in/task-detail/{{1}}",
    hasButton: true,
  }
};

/**
 * Replace placeholders in template text with actual values
 */
function replacePlaceholders(text, params) {
  let result = text;
  params.forEach((param, index) => {
    const placeholder = `{{${index + 1}}}`;
    // Escape curly braces for regex and replace globally
    const escapedPlaceholder = placeholder.replace(/[{}]/g, '\\$&');
    result = result.replace(new RegExp(escapedPlaceholder, "g"), String(param || ""));
  });
  return result;
}

/**
 * Build interactive message payload
 */
function buildInteractivePayload(
  to,
  templateName,
  bodyParams = [],
  ctaParam = null
) {
  const config = TEMPLATE_CONFIG[templateName];

  if (!config) {
    throw new Error(`Template configuration not found for: ${templateName}`);
  }

  // Replace placeholders in body text
  const bodyText = replacePlaceholders(config.body, bodyParams);

  // Build the payload
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: to,
    type: "interactive",
    interactive: {
      type: "cta_url",
      header: {
        type: "text",
        text: config.header,
      },
      body: {
        text: bodyText,
      },
      footer: {
        text: config.footer,
      },
    },
  };

  // Add button if template has one and ctaParam is provided
  if (config.hasButton && ctaParam) {
    // Replace {{1}} in URL pattern with the actual ID
    const url = config.urlPattern.replace("{{1}}", ctaParam);

    payload.interactive.action = {
      name: "cta_url",
      parameters: {
        display_text: config.buttonText,
        url: url,
      },
    };
  }

  return payload;
}

exports.sendWhatsAppTemplate = async (
  to,
  templateName,
  bodyParams = [],
  ctaParam = null
) => {
  try {
    // Normalize phone number to include Indian country code (91)
    const normalizedPhone = normalizeIndianPhoneNumber(to);
    console.log(`📱 Original: ${to} → Normalized: ${normalizedPhone}`);
    
    // Build interactive message payload with normalized phone number
    const payload = buildInteractivePayload(normalizedPhone, templateName, bodyParams, ctaParam);
    
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
