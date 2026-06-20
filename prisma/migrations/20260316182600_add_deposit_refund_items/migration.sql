-- 1. Create Invoice Line Item Table
CREATE TABLE `invoicelineitem` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `invoiceId` INTEGER NOT NULL,
  `description` TEXT NOT NULL,
  `amount` DECIMAL(65,30) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 2. Add Columns to RefundAdjustment Table
ALTER TABLE `refundadjustment` 
  ADD COLUMN `issuedDate` DATETIME(3) NULL,
  ADD COLUMN `method` VARCHAR(191) NULL,
  ADD COLUMN `referenceNumber` VARCHAR(191) NULL,
  ADD COLUMN `proofUrl` VARCHAR(191) NULL,
  ADD COLUMN `outcomeReason` VARCHAR(191) NULL;

-- 3. Add Foreign Key constraints
ALTER TABLE `invoicelineitem` ADD CONSTRAINT `invoicelineitem_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `invoice` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
