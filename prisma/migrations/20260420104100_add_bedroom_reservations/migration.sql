-- AlterTable
ALTER TABLE `bedroom` ADD COLUMN `reserved_flag` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `reserved_by_id` INTEGER NULL,
    ADD COLUMN `reservation_date` DATETIME(3) NULL,
    ADD COLUMN `tentative_move_in_date` DATETIME(3) NULL;

-- CreateIndex
CREATE INDEX `bedroom_reserved_flag_idx` ON `bedroom`(`reserved_flag`);

-- AddForeignKey
ALTER TABLE `bedroom` ADD CONSTRAINT `Bedroom_reserved_by_id_fkey` FOREIGN KEY (`reserved_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
