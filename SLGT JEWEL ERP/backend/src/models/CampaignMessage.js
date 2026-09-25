import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../db.js';
import { shopAuditFields, shopOriginFields } from './_syncFields.js';

export const CampaignMessage = sequelize.define('CampaignMessage', {
  id: { type: DataTypes.STRING, primaryKey: true },
  campaign_id: { type: DataTypes.STRING, allowNull: false },
  customer_id: { type: DataTypes.STRING, allowNull: true },
  customer_name: { type: DataTypes.STRING },
  mobile: { type: DataTypes.STRING },
  message: { type: DataTypes.TEXT },
  whatsapp_url: { type: DataTypes.TEXT },
  status: { type: DataTypes.STRING, defaultValue: 'pending' }, // pending|sent|failed
  ...shopOriginFields,
}, {
  tableName: 'campaign_messages',
  timestamps: true,
  underscored: true,
});
