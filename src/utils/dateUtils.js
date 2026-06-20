const { addDays, isWeekend, format, parseISO, isSameDay } = require('date-fns');

/**
 * Checks if a given date is a business day (Mon-Fri) and NOT a statutory holiday.
 * @param {Date} date - The date to check.
 * @param {Set<string>} holidaySet - A set of YYYY-MM-DD strings.
 */
function isBusinessDay(date, holidaySet = new Set()) {
    if (isWeekend(date)) return false;
    const dateStr = format(date, 'yyyy-MM-dd');
    if (holidaySet.has(dateStr)) return false;
    return true;
}

/**
 * Adds business days to a start date, skipping weekends and statutory holidays.
 * @param {Date} startDate - Start date
 * @param {number} days - Number of business days to add
 * @param {Set<string>} holidaySet - A set of YYYY-MM-DD strings.
 */
function addBusinessDays(startDate, days, holidaySet = new Set()) {
    let result = new Date(startDate);
    let added = 0;
    while (added < days) {
        result = addDays(result, 1);
        if (isBusinessDay(result, holidaySet)) {
            added++;
        }
    }
    return result;
}

module.exports = {
    isBusinessDay,
    addBusinessDays
};
