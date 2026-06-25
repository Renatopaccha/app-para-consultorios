export class BillingService {
  private static readonly BASE_RATE = 19;
  private static readonly BLOCK_SIZE = 5;
  private static readonly BLOCK_DISCOUNT = 0.2; // 20% discount

  /**
   * Calculates the monthly billing amount based on the number of doctors.
   * @param numberOfDoctors - The total number of doctors in the clinic.
   * @returns The total monthly cost in dollars.
   */
  static calculateMonthlyBilling(numberOfDoctors: number): number {
    if (numberOfDoctors < 0) {
      throw new Error('El número de doctores no puede ser negativo');
    }

    const blocksOfFive = Math.floor(numberOfDoctors / this.BLOCK_SIZE);
    const remainingDoctors = numberOfDoctors % this.BLOCK_SIZE;

    // A block of 5 without discount is $95. With 20% discount is $76.
    const blockCost = this.BASE_RATE * this.BLOCK_SIZE * (1 - this.BLOCK_DISCOUNT);
    const remainingCost = remainingDoctors * this.BASE_RATE;

    return (blocksOfFive * blockCost) + remainingCost;
  }
}
