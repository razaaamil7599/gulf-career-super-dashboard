/**
 * Test Blast Script
 * Verifies the Meta WhatsApp Template delivery to a specific target number.
 */

require('dotenv').config({ path: '.env.local' });
const { sendTemplateMessage } = require('../server/services/whatsappService');

// Target Number (Mujahid Bhai) - Update this if needed
const TARGET_PHONE = '918851412030'; 
const TEMPLATE_NAME = 'gcg_hvac_mktg_2';

async function runTest() {
  console.log(`\n🚀 Starting delivery test for: ${TEMPLATE_NAME}`);
  console.log(`📱 Target: ${TARGET_PHONE}\n`);

  try {
    const components = [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: 'Mujahid Bhai' }, // {{1}}
          { type: 'text', text: 'HVAC Technician' } // {{2}}
        ]
      }
    ];

    const result = await sendTemplateMessage(TARGET_PHONE, TEMPLATE_NAME, components);

    if (result.success) {
      console.log('✅ SUCCESS!');
      console.log('📝 Message ID:', result.messageId);
      console.log('📊 Status: sent (check Meta Dashboard for delivered/read)');
    } else {
      console.error('❌ FAILED');
      console.error('📋 Error:', result.error);
      if (result.details) console.error('🔍 Details:', JSON.stringify(result.details, null, 2));
    }
  } catch (err) {
    console.error('💥 CRITICAL ERROR:', err.message);
  }
}

runTest();
