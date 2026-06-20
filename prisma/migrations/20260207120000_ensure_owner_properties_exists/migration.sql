-- Disable foreign key checks to allow dropping tables with active relationships
SET FOREIGN_KEY_CHECKS = 0;

-- Drop the table if it exists to handle casing conflicts or known missing table issues
DROP TABLE IF EXISTS `_ownerproperties`;
DROP TABLE IF EXISTS `_OwnerProperties`;

-- Create the table explicitly with lowercase name as requested
CREATE TABLE `_ownerproperties` (
    `A` INTEGER NOT NULL,
    `B` INTEGER NOT NULL,

    UNIQUE INDEX `_ownerproperties_AB_unique`(`A`, `B`),
    INDEX `_ownerproperties_B_index`(`B`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Add foreign keys
ALTER TABLE `_ownerproperties` ADD CONSTRAINT `_ownerproperties_A_fkey` FOREIGN KEY (`A`) REFERENCES `property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `_ownerproperties` ADD CONSTRAINT `_ownerproperties_B_fkey` FOREIGN KEY (`B`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Re-enable foreign key checks
SET FOREIGN_KEY_CHECKS = 1;
