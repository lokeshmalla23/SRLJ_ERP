export { User } from './User.js';
export { Category } from './Category.js';
export { Attribute } from './Attribute.js';
export { CatalogItem } from './CatalogItem.js';
export { Product } from './Product.js';
export { Customer } from './Customer.js';
export { Invoice } from './Invoice.js';
export { Scheme } from './Scheme.js';
export { SchemePlan } from './SchemePlan.js';
export { Campaign } from './Campaign.js';
export { CampaignMessage } from './CampaignMessage.js';
export { ExpenseCategory } from './ExpenseCategory.js';
export { Expense } from './Expense.js';
export { Income } from './Income.js';
export { DailyClosing } from './DailyClosing.js';
export { Notification } from './Notification.js';
export { StockHistory } from './StockHistory.js';
export { InventoryAdjustment } from './InventoryAdjustment.js';
export { Employee } from './Employee.js';
export { Quotation } from './Quotation.js';
export { Vendor } from './Vendor.js';
export { Purchase } from './Purchase.js';
export { Order } from './Order.js';
export { BarcodeTemplate } from './BarcodeTemplate.js';
export { Setting } from './Setting.js';
export { Shop } from './Shop.js';
export { Device } from './Device.js';
export { InvoiceSequence } from './InvoiceSequence.js';
export { BarcodeSequence } from './BarcodeSequence.js';
export { SchemaMeta } from './SchemaMeta.js';
export { InventoryMovement } from './InventoryMovement.js';
export { SaleAuthority } from './SaleAuthority.js';
export { ClusterState } from './ClusterState.js';
export { EventLog } from './EventLog.js';
export { OperationLedger } from './OperationLedger.js';
export { AuditEvent } from './AuditEvent.js';
export { ReplicaAck } from './ReplicaAck.js';
export { Payment } from './Payment.js';
export { CustomerAdvance, CustomerAdvanceApplication } from './CustomerAdvance.js';
export { ProductStatusHistory } from './ProductStatusHistory.js';
export { ChartOfAccount, JournalEntry, JournalLine } from './ChartOfAccount.js';
export { ShopCounter } from './ShopCounter.js';
export { CreditNote, OldGoldReceipt, HsnCode } from './CreditNote.js';
export { OldGoldSale } from './OldGoldSale.js';
export { DraftSale } from './DraftSale.js';
export { InvoiceItem } from './InvoiceItem.js';
export { PurchaseItem } from './PurchaseItem.js';
export { CashbookEntry } from './CashbookEntry.js';
export { MetalIssue } from './MetalIssue.js';
export { GoldRateHistory, BillingRateEvent } from './GoldRateHistory.js';
export { PureProduct } from './PureProduct.js';
export { BankAccount, BankReconciliationItem } from './BankAccount.js';
export { BarcodeStockCheckSession } from './BarcodeStockCheckSession.js';
export { BarcodeStockCheckScan } from './BarcodeStockCheckScan.js';

import { User } from './User.js';
import { Category } from './Category.js';
import { Attribute } from './Attribute.js';
import { CatalogItem } from './CatalogItem.js';
import { Product } from './Product.js';
import { Customer } from './Customer.js';
import { Invoice } from './Invoice.js';
import { Scheme } from './Scheme.js';
import { SchemePlan } from './SchemePlan.js';
import { Campaign } from './Campaign.js';
import { CampaignMessage } from './CampaignMessage.js';
import { ExpenseCategory } from './ExpenseCategory.js';
import { Expense } from './Expense.js';
import { Income } from './Income.js';
import { DailyClosing } from './DailyClosing.js';
import { Notification } from './Notification.js';
import { StockHistory } from './StockHistory.js';
import { InventoryAdjustment } from './InventoryAdjustment.js';
import { Employee } from './Employee.js';
import { Quotation } from './Quotation.js';
import { Vendor } from './Vendor.js';
import { Purchase } from './Purchase.js';
import { Order } from './Order.js';
import { BarcodeTemplate } from './BarcodeTemplate.js';
import { Setting } from './Setting.js';
import { Payment } from './Payment.js';
import { CustomerAdvance, CustomerAdvanceApplication } from './CustomerAdvance.js';
import { ProductStatusHistory } from './ProductStatusHistory.js';
import { ChartOfAccount, JournalEntry, JournalLine } from './ChartOfAccount.js';
import { ShopCounter } from './ShopCounter.js';
import { CreditNote, OldGoldReceipt, HsnCode } from './CreditNote.js';
import { OldGoldSale } from './OldGoldSale.js';
import { CashbookEntry } from './CashbookEntry.js';
import { MetalIssue } from './MetalIssue.js';
import { GoldRateHistory, BillingRateEvent } from './GoldRateHistory.js';
import { PureProduct } from './PureProduct.js';
import { BankAccount, BankReconciliationItem } from './BankAccount.js';
import { BarcodeStockCheckSession } from './BarcodeStockCheckSession.js';
import { BarcodeStockCheckScan } from './BarcodeStockCheckScan.js';
import { attachDefaultShopHooks } from '../services/defaultShop.js';

/** Models that carry shop_id and should auto-fill on create. */
const SHOP_SCOPED_MODELS = [
  User, Category, Attribute, CatalogItem, Product, Customer, Invoice,
  Scheme, SchemePlan, Campaign, CampaignMessage, ExpenseCategory, Expense, Income,
  DailyClosing, Notification, StockHistory, InventoryAdjustment, Employee,
  Quotation, Vendor, Purchase, Order, BarcodeTemplate, Setting,
  Payment, CustomerAdvance, CustomerAdvanceApplication, ProductStatusHistory,
  ChartOfAccount, JournalEntry, JournalLine, ShopCounter,
  CreditNote, OldGoldReceipt, HsnCode, OldGoldSale,
  CashbookEntry, MetalIssue, GoldRateHistory, BillingRateEvent,
  PureProduct,
  BankAccount, BankReconciliationItem,
  BarcodeStockCheckSession, BarcodeStockCheckScan,
];

attachDefaultShopHooks(SHOP_SCOPED_MODELS);
