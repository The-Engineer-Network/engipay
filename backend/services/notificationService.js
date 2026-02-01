/**
 * Notification Service
 * Backend Dev 4 Task - Notification system and webhooks
 * 
 * Features:
 * - Email notifications (SendGrid)
 * - SMS notifications (Twilio)
 * - Push notifications
 * - Webhook management
 * - Event-based notifications
 */

const axios = require('axios');

class NotificationService {
  constructor() {
    // SendGrid configuration
    this.sendGridApiKey = process.env.SENDGRID_API_KEY;
    this.sendGridFromEmail = process.env.SENDGRID_FROM_EMAIL || 'noreply@engipay.com';
    
    // Twilio configuration
    this.twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
    this.twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
    this.twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;
    
    // Webhook storage (in production, use database)
    this.webhooks = new Map();
    
    // Notification queue (in production, use Redis or message queue)
    this.notificationQueue = [];
    
    // Event types
    this.eventTypes = {
      TRANSACTION_CONFIRMED: 'transaction.confirmed',
      TRANSACTION_FAILED: 'transaction.failed',
      SWAP_COMPLETED: 'swap.completed',
      SWAP_FAILED: 'swap.failed',
      PRICE_ALERT: 'price.alert',
      DEPOSIT_RECEIVED: 'deposit.received',
      WITHDRAWAL_COMPLETED: 'withdrawal.completed',
      LENDING_POSITION_UPDATED: 'lending.position.updated',
      REWARD_CLAIMED: 'reward.claimed',
      SECURITY_ALERT: 'security.alert'
    };
  }

  /**
   * Send email notification via SendGrid
   */
  async sendEmail(to, subject, htmlContent, textContent = null) {
    if (!this.sendGridApiKey) {
      console.warn('SendGrid API key not configured, skipping email');
      return { success: false, error: 'SendGrid not configured' };
    }

    try {
      const response = await axios.post(
        'https://api.sendgrid.com/v3/mail/send',
        {
          personalizations: [{
            to: [{ email: to }],
            subject
          }],
          from: { email: this.sendGridFromEmail },
          content: [
            {
              type: 'text/html',
              value: htmlContent
            },
            ...(textContent ? [{
              type: 'text/plain',
              value: textContent
            }] : [])
          ]
        },
        {
          headers: {
            'Authorization': `Bearer ${this.sendGridApiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return { success: true, messageId: response.headers['x-message-id'] };
    } catch (error) {
      console.error('SendGrid Error:', error.response?.data || error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send SMS notification via Twilio
   */
  async sendSMS(to, message) {
    if (!this.twilioAccountSid || !this.twilioAuthToken) {
      console.warn('Twilio not configured, skipping SMS');
      return { success: false, error: 'Twilio not configured' };
    }

    try {
      const auth = Buffer.from(`${this.twilioAccountSid}:${this.twilioAuthToken}`).toString('base64');
      
      const response = await axios.post(
        `https://api.twilio.com/2010-04-01/Accounts/${this.twilioAccountSid}/Messages.json`,
        new URLSearchParams({
          To: to,
          From: this.twilioPhoneNumber,
          Body: message
        }),
        {
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );

      return { success: true, sid: response.data.sid };
    } catch (error) {
      console.error('Twilio Error:', error.response?.data || error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Register webhook
   */
  registerWebhook(id, url, events, secret = null) {
    this.webhooks.set(id, {
      url,
      events: Array.isArray(events) ? events : [events],
      secret,
      active: true,
      createdAt: new Date(),
      lastTriggered: null,
      failureCount: 0
    });

    return { success: true, webhookId: id };
  }

  /**
   * Unregister webhook
   */
  unregisterWebhook(id) {
    const deleted = this.webhooks.delete(id);
    return { success: deleted };
  }

  /**
   * Get webhook
   */
  getWebhook(id) {
    return this.webhooks.get(id);
  }

  /**
   * List all webhooks
   */
  listWebhooks() {
    return Array.from(this.webhooks.entries()).map(([id, webhook]) => ({
      id,
      ...webhook
    }));
  }

  /**
   * Trigger webhook
   */
  async triggerWebhook(eventType, data) {
    const webhooksToTrigger = Array.from(this.webhooks.entries())
      .filter(([_, webhook]) => 
        webhook.active && webhook.events.includes(eventType)
      );

    const results = [];

    for (const [id, webhook] of webhooksToTrigger) {
      try {
        const payload = {
          event: eventType,
          data,
          timestamp: new Date().toISOString(),
          webhookId: id
        };

        const headers = {
          'Content-Type': 'application/json',
          'User-Agent': 'EngiPay-Webhook/1.0'
        };

        // Add signature if secret is configured
        if (webhook.secret) {
          const crypto = require('crypto');
          const signature = crypto
            .createHmac('sha256', webhook.secret)
            .update(JSON.stringify(payload))
            .digest('hex');
          headers['X-EngiPay-Signature'] = signature;
        }

        const response = await axios.post(webhook.url, payload, {
          headers,
          timeout: 10000
        });

        webhook.lastTriggered = new Date();
        webhook.failureCount = 0;

        results.push({
          webhookId: id,
          success: true,
          status: response.status
        });
      } catch (error) {
        webhook.failureCount++;
        
        // Disable webhook after 5 consecutive failures
        if (webhook.failureCount >= 5) {
          webhook.active = false;
        }

        results.push({
          webhookId: id,
          success: false,
          error: error.message
        });

        console.error(`Webhook ${id} failed:`, error.message);
      }
    }

    return results;
  }

  /**
   * Send transaction notification
   */
  async notifyTransaction(userId, transaction, userEmail = null, userPhone = null) {
    const { type, status, amount, currency, hash } = transaction;

    // Determine event type
    let eventType;
    if (status === 'confirmed') {
      eventType = this.eventTypes.TRANSACTION_CONFIRMED;
    } else if (status === 'failed') {
      eventType = this.eventTypes.TRANSACTION_FAILED;
    }

    // Send email
    if (userEmail) {
      const subject = `Transaction ${status}: ${amount} ${currency}`;
      const html = this.generateTransactionEmail(transaction);
      await this.sendEmail(userEmail, subject, html);
    }

    // Send SMS for high-value transactions
    if (userPhone && amount > 1000) {
      const message = `EngiPay: Your ${type} of ${amount} ${currency} is ${status}. Tx: ${hash?.substring(0, 10)}...`;
      await this.sendSMS(userPhone, message);
    }

    // Trigger webhooks
    await this.triggerWebhook(eventType, {
      userId,
      transaction
    });

    return { success: true };
  }

  /**
   * Send swap notification
   */
  async notifySwap(userId, swap, userEmail = null) {
    const { status, fromAmount, fromCurrency, toAmount, toCurrency } = swap;

    const eventType = status === 'completed' 
      ? this.eventTypes.SWAP_COMPLETED 
      : this.eventTypes.SWAP_FAILED;

    if (userEmail) {
      const subject = `Swap ${status}: ${fromAmount} ${fromCurrency} → ${toAmount} ${toCurrency}`;
      const html = this.generateSwapEmail(swap);
      await this.sendEmail(userEmail, subject, html);
    }

    await this.triggerWebhook(eventType, {
      userId,
      swap
    });

    return { success: true };
  }

  /**
   * Send price alert
   */
  async notifyPriceAlert(userId, alert, userEmail = null, userPhone = null) {
    const { coin, targetPrice, currentPrice, condition } = alert;

    if (userEmail) {
      const subject = `Price Alert: ${coin} ${condition} ${targetPrice}`;
      const html = this.generatePriceAlertEmail(alert);
      await this.sendEmail(userEmail, subject, html);
    }

    if (userPhone) {
      const message = `EngiPay: ${coin} price alert! Current: $${currentPrice}, Target: $${targetPrice}`;
      await this.sendSMS(userPhone, message);
    }

    await this.triggerWebhook(this.eventTypes.PRICE_ALERT, {
      userId,
      alert
    });

    return { success: true };
  }

  /**
   * Generate transaction email HTML
   */
  generateTransactionEmail(transaction) {
    const { type, status, amount, currency, hash, timestamp } = transaction;
    
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #4F46E5; color: white; padding: 20px; text-align: center; }
          .content { background: #f9f9f9; padding: 20px; }
          .status { font-weight: bold; color: ${status === 'confirmed' ? '#10B981' : '#EF4444'}; }
          .details { background: white; padding: 15px; margin: 10px 0; border-radius: 5px; }
          .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>EngiPay Transaction Update</h1>
          </div>
          <div class="content">
            <p>Your transaction has been <span class="status">${status}</span>.</p>
            <div class="details">
              <p><strong>Type:</strong> ${type}</p>
              <p><strong>Amount:</strong> ${amount} ${currency}</p>
              <p><strong>Status:</strong> ${status}</p>
              <p><strong>Transaction Hash:</strong> ${hash || 'N/A'}</p>
              <p><strong>Time:</strong> ${new Date(timestamp).toLocaleString()}</p>
            </div>
          </div>
          <div class="footer">
            <p>© 2026 EngiPay. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Generate swap email HTML
   */
  generateSwapEmail(swap) {
    const { status, fromAmount, fromCurrency, toAmount, toCurrency, timestamp } = swap;
    
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #4F46E5; color: white; padding: 20px; text-align: center; }
          .content { background: #f9f9f9; padding: 20px; }
          .status { font-weight: bold; color: ${status === 'completed' ? '#10B981' : '#EF4444'}; }
          .swap-details { background: white; padding: 15px; margin: 10px 0; border-radius: 5px; text-align: center; }
          .arrow { font-size: 24px; color: #4F46E5; margin: 10px 0; }
          .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>EngiPay Swap Update</h1>
          </div>
          <div class="content">
            <p>Your swap has been <span class="status">${status}</span>.</p>
            <div class="swap-details">
              <p><strong>${fromAmount} ${fromCurrency}</strong></p>
              <div class="arrow">↓</div>
              <p><strong>${toAmount} ${toCurrency}</strong></p>
              <p style="margin-top: 15px;"><strong>Status:</strong> ${status}</p>
              <p><strong>Time:</strong> ${new Date(timestamp).toLocaleString()}</p>
            </div>
          </div>
          <div class="footer">
            <p>© 2026 EngiPay. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Generate price alert email HTML
   */
  generatePriceAlertEmail(alert) {
    const { coin, targetPrice, currentPrice, condition } = alert;
    
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #4F46E5; color: white; padding: 20px; text-align: center; }
          .content { background: #f9f9f9; padding: 20px; text-align: center; }
          .price { font-size: 36px; font-weight: bold; color: #4F46E5; margin: 20px 0; }
          .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🔔 Price Alert Triggered!</h1>
          </div>
          <div class="content">
            <h2>${coin}</h2>
            <div class="price">$${currentPrice}</div>
            <p>Your price alert has been triggered!</p>
            <p><strong>Condition:</strong> ${condition} $${targetPrice}</p>
            <p><strong>Current Price:</strong> $${currentPrice}</p>
          </div>
          <div class="footer">
            <p>© 2026 EngiPay. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }
}

// Singleton instance
const notificationService = new NotificationService();

module.exports = notificationService;
