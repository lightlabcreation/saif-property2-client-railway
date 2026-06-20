-- AlterTable
ALTER TABLE `unit` ADD COLUMN `availability_status` ENUM('Unavailable', 'Available', 'Reserved', 'Occupied') NOT NULL DEFAULT 'Unavailable',
    ADD COLUMN `current_owner` ENUM('GC', 'OPERATIONS') NULL,
    ADD COLUMN `current_stage` VARCHAR(191) NULL,
    ADD COLUMN `ffe_installed_completed` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `ffe_installed_completed_date` DATETIME(3) NULL,
    ADD COLUMN `ffe_installed_target_date` DATETIME(3) NULL,
    ADD COLUMN `final_cleaning_completed` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `final_cleaning_completed_date` DATETIME(3) NULL,
    ADD COLUMN `final_cleaning_target_date` DATETIME(3) NULL,
    ADD COLUMN `gc_cleaned_completed` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `gc_cleaned_completed_date` DATETIME(3) NULL,
    ADD COLUMN `gc_cleaned_target_date` DATETIME(3) NULL,
    ADD COLUMN `gc_deficiencies_completed` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `gc_deficiencies_completed_date` DATETIME(3) NULL,
    ADD COLUMN `gc_deficiencies_target_date` DATETIME(3) NULL,
    ADD COLUMN `gc_delivered_completed` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `gc_delivered_completed_date` DATETIME(3) NULL,
    ADD COLUMN `gc_delivered_target_date` DATETIME(3) NULL,
    ADD COLUMN `ose_installed_completed` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `ose_installed_completed_date` DATETIME(3) NULL,
    ADD COLUMN `ose_installed_target_date` DATETIME(3) NULL,
    ADD COLUMN `ready_for_leasing` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `reservation_date` DATETIME(3) NULL,
    ADD COLUMN `reserved_by_id` INTEGER NULL,
    ADD COLUMN `reserved_flag` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `status_note` TEXT NULL,
    ADD COLUMN `tentative_move_in_date` DATETIME(3) NULL,
    ADD COLUMN `unit_ready_completed` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `unit_ready_completed_date` DATETIME(3) NULL,
    ADD COLUMN `unit_ready_target_date` DATETIME(3) NULL,
    ADD COLUMN `unit_status` ENUM('INACTIVE', 'ACTIVE') NOT NULL DEFAULT 'INACTIVE';

-- CreateTable
CREATE TABLE `timelinesetting` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `key` VARCHAR(191) NOT NULL,
    `days` INTEGER NOT NULL,

    UNIQUE INDEX `timelinesetting_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `unit_unit_status_idx` ON `unit`(`unit_status`);
CREATE INDEX `unit_availability_status_idx` ON `unit`(`availability_status`);
CREATE INDEX `unit_reserved_flag_idx` ON `unit`(`reserved_flag`);

-- AddForeignKey
ALTER TABLE `unit` ADD CONSTRAINT `unit_reserved_by_id_fkey` FOREIGN KEY (`reserved_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
